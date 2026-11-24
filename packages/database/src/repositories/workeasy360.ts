import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { Db } from "../client.js";
import { withContext } from "../context.js";
import type { MembershipRole } from "../schema.js";
import { appendAudit } from "./audit.js";
import { findOrCreateUser, PASSWORD_ISSUER } from "./identity.js";

/**
 * WorkEasy360 Accounts sign-in for the merchant admin (docs/workeasy360-sso.md):
 * sign-in flows, the organization that owns stores, back-channel logout and
 * the shared entitlement answers. Platform-level rows are reached only
 * through the SECURITY DEFINER functions of migration 0017.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

// --- sign-in flows -------------------------------------------------------------

export interface LoginFlow {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** The WorkEasy360 organization the launcher named, if any. */
  organizationId: string | null;
  returnTo: string | null;
}

/** Keeps a flow on the server under the SHA-256 of the browser's random flow id. */
export async function saveLoginFlow(db: Db, flowId: string, flow: LoginFlow, ttlSeconds: number): Promise<void> {
  await sql`SELECT app.workeasy360_save_login_flow(
      ${sha256(flowId)}, ${flow.state}, ${flow.nonce}, ${flow.codeVerifier},
      ${flow.organizationId}::uuid, ${flow.returnTo}, ${ttlSeconds}::integer)`.execute(db);
}

/** Takes (deletes) the flow: it is used once, whatever the callback does next. Undefined when unknown or expired. */
export async function takeLoginFlow(db: Db, flowId: string): Promise<LoginFlow | undefined> {
  const { rows } = await sql<{ state: string; nonce: string; code_verifier: string; organization_id: string | null; return_to: string | null }>`
    SELECT state, nonce, code_verifier, organization_id, return_to FROM app.workeasy360_take_login_flow(${sha256(flowId)})`.execute(db);
  const row = rows[0];
  return row
    ? { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier, organizationId: row.organization_id, returnTo: row.return_to }
    : undefined;
}

// --- organizations and their stores ------------------------------------------------

export interface OrganizationStore {
  storeId: string;
  status: "active" | "suspended";
}

/** The stores a WorkEasy360 organization owns, oldest first. */
export async function organizationStores(db: Db, organizationId: string): Promise<OrganizationStore[]> {
  if (!UUID_PATTERN.test(organizationId)) return [];
  const { rows } = await sql<{ store_id: string; status: "active" | "suspended" }>`
    SELECT store_id, status FROM app.workeasy360_organization_stores(${organizationId.toLowerCase()}::uuid)`.execute(db);
  return rows.map((r) => ({ storeId: r.store_id, status: r.status }));
}

/** The WorkEasy360 organization of a store, answered only for an active member of it. */
export async function memberStoreOrganization(db: Db, storeId: string, userId: string): Promise<string | undefined> {
  if (!UUID_PATTERN.test(storeId) || !UUID_PATTERN.test(userId)) return undefined;
  const { rows } = await sql<{ org: string | null }>`SELECT app.member_store_workeasy360_org(${storeId}::uuid, ${userId}::uuid) AS org`.execute(db);
  return rows[0]?.org ?? undefined;
}

/** The WorkEasy360 organization of a store (for an invitation the caller holds). */
export async function storeOrganization(db: Db, storeId: string): Promise<string | undefined> {
  if (!UUID_PATTERN.test(storeId)) return undefined;
  const { rows } = await sql<{ org: string | null }>`SELECT app.store_workeasy360_org(${storeId}::uuid) AS org`.execute(db);
  return rows[0]?.org ?? undefined;
}

/** Issuers other than `issuer` under which this subject already has a user (password accounts excluded). */
export async function otherIssuersForSubject(db: Db, issuer: string, subject: string): Promise<string[]> {
  const { rows } = await sql<{ issuer: string }>`SELECT issuer FROM app.find_issuers_for_subject(${subject})`.execute(db);
  return rows.map((r) => r.issuer).filter((i) => i !== issuer && i !== PASSWORD_ISSUER);
}

export interface Workeasy360SignIn {
  issuer: string;
  subject: string;
  displayName?: string | undefined;
  /** The WorkEasy360 organization the ID token named. */
  organizationId: string;
  /** The role someone gets in an organization's store they do not belong to yet. */
  defaultRole: MembershipRole;
  /** Whether an organization with no store yet may sign in (its first person then creates the first store). */
  provisionStores: boolean;
  requestId?: string | undefined;
}

export type ProvisionOutcome =
  | {
      kind: "ok";
      userId: string;
      /** The organization's active stores this person may now open (none yet: they create the first). */
      storeIds: string[];
      /** Stores this sign-in made them a member of. */
      joined: string[];
    }
  | { kind: "refused"; code: "membership_revoked" | "no_store" | "identity_conflict"; detail: string };

/**
 * Maps a verified WorkEasy360 sign-in onto this product's rows.
 *
 * - The person is the user keyed on (issuer, sub). Never on email.
 * - The organization owns stores (stores.workeasy360_organization_id): linked by
 *   the operator, or created by its people in the admin. With none yet, the
 *   first person signs in and creates the first store.
 * - Access is membership in each of those stores: an active one keeps its
 *   role; a revoked one stays revoked (a store administrator removed the
 *   person); none yet is created with the default role. Someone revoked from
 *   every store of the organization is refused.
 */
export async function provisionSignIn(db: Db, input: Workeasy360SignIn): Promise<ProvisionOutcome> {
  const organizationId = input.organizationId.toLowerCase();
  if (!UUID_PATTERN.test(organizationId)) return { kind: "refused", code: "no_store", detail: "organization_id is not a UUID" };

  // An issuer move (ADR-067) without the identity move would split one person into two accounts.
  const existingElsewhere = await otherIssuersForSubject(db, input.issuer, input.subject);
  const known = await sql<{ id: string | null }>`SELECT app.find_user_id_by_identity(${input.issuer}, ${input.subject}) AS id`.execute(db);
  if (!known.rows[0]?.id && existingElsewhere.length > 0) {
    return { kind: "refused", code: "identity_conflict", detail: `subject already has a user under ${existingElsewhere.length} other issuer(s); run move-identity-issuer` };
  }

  const stores = (await organizationStores(db, organizationId)).filter((s) => s.status === "active");
  if (stores.length === 0 && !input.provisionStores) {
    return { kind: "refused", code: "no_store", detail: "no store is linked to this organization" };
  }
  const userId = await findOrCreateUser(db, { issuer: input.issuer, subject: input.subject, ...(input.displayName ? { displayName: input.displayName } : {}) });

  const storeIds: string[] = [];
  const joined: string[] = [];
  for (const { storeId } of stores) {
    const outcome = await withContext(db, { storeId, userId }, async (trx) => {
      const membership = await trx.selectFrom("memberships").select(["role", "status"]).where("user_id", "=", userId).executeTakeFirst();
      if (membership) return membership.status === "active" ? "member" : "revoked";
      await trx
        .insertInto("memberships")
        .values({ store_id: storeId, user_id: userId, role: input.defaultRole })
        .onConflict((oc) => oc.columns(["store_id", "user_id"]).doNothing())
        .execute();
      await appendAudit(trx, {
        storeId,
        actor: { type: "user", id: userId },
        action: "member.joined_from_workeasy",
        resourceType: "member",
        resourceId: userId,
        requestId: input.requestId,
        metadata: { role: input.defaultRole },
      });
      return "joined";
    });
    if (outcome !== "revoked") storeIds.push(storeId);
    if (outcome === "joined") joined.push(storeId);
  }
  if (stores.length > 0 && storeIds.length === 0) {
    return { kind: "refused", code: "membership_revoked", detail: `user ${userId} is revoked from every store of the organization` };
  }
  return { kind: "ok", userId, storeIds, joined };
}

// --- back-channel logout --------------------------------------------------------

export interface LogoutTokenFacts {
  issuer: string;
  jti: string;
  subject?: string | undefined;
  sid?: string | undefined;
  /** After this instant the token is refused anyway, so its jti need not be remembered longer. */
  acceptableUntil: Date;
}

export type LogoutOutcome = { replayed: true } | { replayed: false; sessionsEnded: number };

/** Records the jti and ends the sessions the token names, in one transaction. */
export async function endSessions(db: Db, token: LogoutTokenFacts): Promise<LogoutOutcome> {
  const { rows } = await sql<{ replayed: boolean; sessions_ended: number }>`
    SELECT replayed, sessions_ended FROM app.workeasy360_end_sessions(
      ${token.issuer}, ${token.jti}, ${token.acceptableUntil}, ${token.subject ?? null}, ${token.sid ?? null})`.execute(db);
  const row = rows[0];
  if (!row) throw new Error("workeasy360_end_sessions returned nothing");
  return row.replayed ? { replayed: true } : { replayed: false, sessionsEnded: Number(row.sessions_ended) };
}

// --- entitlement answers ---------------------------------------------------------

export async function getEntitlementAnswer(db: Db, key: string): Promise<string | null> {
  const { rows } = await sql<{ answer: unknown }>`SELECT app.workeasy360_entitlement_get(${key}) AS answer`.execute(db);
  const answer = rows[0]?.answer;
  return answer === null || answer === undefined ? null : JSON.stringify(answer);
}

/** `ttlSeconds` null: kept without expiry (a known denial must never lapse). */
export async function putEntitlementAnswer(db: Db, key: string, value: string, ttlSeconds: number | null): Promise<void> {
  await sql`SELECT app.workeasy360_entitlement_put(${key}, ${value}::jsonb, ${ttlSeconds}::integer)`.execute(db);
}

// --- operator commands -------------------------------------------------------------

export class OperatorError extends Error {
  override name = "OperatorError";
}

export interface LinkResult {
  storeId: string;
  storeName: string;
  organizationId: string;
  /** False: it was already linked to exactly this organization. */
  changed: boolean;
}

/**
 * `link-workeasy360-organization <store> <organization>`: an existing store
 * now belongs to a WorkEasy360 organization, so that organization's people
 * reach it through WorkEasy360 (several stores may belong to one
 * organization). Runs as the owner role. A store linked to another
 * organization is never re-pointed silently.
 */
export async function linkStore(ownerDb: Db, storeId: string, organizationId: string): Promise<LinkResult> {
  if (!UUID_PATTERN.test(storeId)) throw new OperatorError("The store id must be a UUID.");
  if (!UUID_PATTERN.test(organizationId)) throw new OperatorError("The WorkEasy360 organization id must be a UUID.");
  const target = organizationId.toLowerCase();
  const store = await withContext(ownerDb, { storeId }, (trx) =>
    trx.selectFrom("stores").select(["id", "name", "workeasy360_organization_id"]).where("id", "=", storeId).executeTakeFirst(),
  );
  if (!store) throw new OperatorError(`No store ${storeId}.`);
  if (store.workeasy360_organization_id === target) return { storeId, storeName: store.name, organizationId: target, changed: false };
  if (store.workeasy360_organization_id) {
    throw new OperatorError(
      `${store.name} already belongs to WorkEasy360 organization ${store.workeasy360_organization_id}. Unlink it deliberately before linking it to another one.`,
    );
  }
  await withContext(ownerDb, { storeId }, async (trx) => {
    await trx.updateTable("stores").set({ workeasy360_organization_id: target }).where("id", "=", storeId).execute();
    await appendAudit(trx, {
      storeId,
      actor: { type: "system" },
      action: "store.linked_to_workeasy",
      resourceType: "store",
      resourceId: storeId,
      metadata: { workeasy360OrganizationId: target },
    });
  });
  return { storeId, storeName: store.name, organizationId: target, changed: true };
}

export interface IssuerCount {
  issuer: string;
  users: number;
  liveSessions: number;
}

/** `workeasy360-identities`: how many users (and live sessions) each issuer holds. */
export async function countIdentities(ownerDb: Db): Promise<IssuerCount[]> {
  const { rows } = await sql<{ issuer: string; users: string; live: string }>`
    SELECT u.issuer, count(DISTINCT u.id) AS users,
           count(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > now()) AS live
      FROM app.users u LEFT JOIN app.auth_sessions s ON s.user_id = u.id
     GROUP BY u.issuer ORDER BY u.issuer`.execute(ownerDb);
  return rows.map((r) => ({ issuer: r.issuer, users: Number(r.users), liveSessions: Number(r.live) }));
}

export interface IssuerMovePlan {
  from: string;
  to: string;
  movable: number;
  /** Subjects that already have a user under the new issuer: moving would merge two accounts. */
  conflicts: { subject: string; fromUserId: string; toUserId: string }[];
  applied: boolean;
}

/**
 * `move-identity-issuer --from <issuer> --to <issuer> [--apply]`: the
 * identity-link move of an issuer change. Every user (from, sub) becomes
 * (to, sub), and so do the live WorkEasy360 sessions. Never merges: a subject
 * that already has a user under the new issuer refuses the whole move.
 */
export async function moveIssuer(ownerDb: Db, from: string, to: string, apply: boolean): Promise<IssuerMovePlan> {
  if (!from || !to || from === to) throw new OperatorError("Give two different issuers: --from <issuer> --to <issuer>.");
  if (from === PASSWORD_ISSUER || to === PASSWORD_ISSUER) throw new OperatorError("Password accounts are not moved between issuers.");
  const { rows: movable } = await sql<{ id: string; subject: string }>`SELECT id, subject FROM app.users WHERE issuer = ${from}`.execute(ownerDb);
  const { rows: conflicts } = await sql<{ subject: string; from_id: string; to_id: string }>`
    SELECT a.subject, a.id AS from_id, b.id AS to_id
      FROM app.users a JOIN app.users b ON b.subject = a.subject AND b.issuer = ${to}
     WHERE a.issuer = ${from}`.execute(ownerDb);
  const plan: IssuerMovePlan = {
    from,
    to,
    movable: movable.length,
    conflicts: conflicts.map((c) => ({ subject: c.subject, fromUserId: c.from_id, toUserId: c.to_id })),
    applied: false,
  };
  if (!apply || plan.conflicts.length > 0 || movable.length === 0) return plan;
  await ownerDb.transaction().execute(async (trx) => {
    for (const user of movable) {
      // users_update_self: each identity row changes in its own user context.
      await sql`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.store_id', '', true)`.execute(trx);
      await trx.updateTable("users").set({ issuer: to }).where("id", "=", user.id).where("issuer", "=", from).execute();
    }
    await sql`UPDATE app.auth_sessions SET w360_issuer = ${to} WHERE w360_issuer = ${from} AND revoked_at IS NULL`.execute(trx);
  });
  return { ...plan, applied: true };
}

export interface UserLinkResult {
  userId: string;
  fromIssuer: string;
  toIssuer: string;
  subject: string;
}

/**
 * `link-workeasy360-user <user> <sub> [--issuer]`: an operator vouches that an
 * existing account is this WorkEasy360 person and re-keys it to (issuer, sub),
 * keeping its memberships. Refused when that identity already has its own user.
 */
export async function linkUserIdentity(ownerDb: Db, userId: string, issuer: string, subject: string): Promise<UserLinkResult> {
  if (!UUID_PATTERN.test(userId)) throw new OperatorError("The user id must be a UUID.");
  if (!issuer || !subject || subject.length > 255) throw new OperatorError("Give the WorkEasy360 issuer and the person's sub.");
  const { rows: current } = await sql<{ issuer: string; subject: string }>`SELECT issuer, subject FROM app.users WHERE id = ${userId}::uuid`.execute(ownerDb);
  const user = current[0];
  if (!user) throw new OperatorError(`No user ${userId}.`);
  if (user.issuer === issuer && user.subject === subject) return { userId, fromIssuer: issuer, toIssuer: issuer, subject };
  if (user.issuer === issuer) throw new OperatorError(`User ${userId} is already a different WorkEasy360 identity (${user.subject}).`);
  const { rows: taken } = await sql<{ id: string | null }>`SELECT app.find_user_id_by_identity(${issuer}, ${subject}) AS id`.execute(ownerDb);
  if (taken[0]?.id) {
    throw new OperatorError(
      `WorkEasy360 identity ${subject} already has its own user ${taken[0].id}. Give that user the access it needs instead (Team page), or resolve the two accounts by hand.`,
    );
  }
  await withContext(ownerDb, { userId }, (trx) => trx.updateTable("users").set({ issuer, subject }).where("id", "=", userId).execute());
  return { userId, fromIssuer: user.issuer, toIssuer: issuer, subject };
}
