import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Router } from "express";
import { canAssignRole, isStoreRole, type StoreRole } from "@workeasy/auth";
import { auditRepo, membersRepo, storesRepo, withContext, withStore, type Invitation } from "@workeasy/database";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { problems, sendProblem } from "../http/problem.js";
import { actorOf, invalid, issuesToErrors, respond, sessionOf, UUID_PATTERN, type StoreAccess } from "./support.js";

export const INVITATION_DAYS = 7;
export const INVITATION_CREATED_V1 = "invitation.created.v1";
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** The TXT record a merchant adds to prove they control a domain. */
export const verificationRecord = (domain: string, token: string) => ({ name: `_workeasy360.${domain}`, value: `workeasy360-verify=${token}` });

/** Looks up TXT records; tests answer for DNS. */
export type ResolveTxt = (name: string) => Promise<string[][]>;

const InviteBodySchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase().max(254).nullable().optional().or(z.literal("").transform(() => null)),
  role: z.enum(["owner", "admin", "staff", "fulfillment", "analyst"]),
});

const MemberPatchSchema = z
  .object({ role: z.enum(["owner", "admin", "staff", "fulfillment", "analyst"]).optional(), status: z.enum(["active", "revoked"]).optional() })
  .refine((b) => b.role !== undefined || b.status !== undefined, { message: "Nothing to change" });

const DomainBodySchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, ""))
    .pipe(z.string().max(253).regex(DOMAIN, "Enter a domain like shop.example.com")),
});

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest();

function invitationJson(i: Invitation) {
  return { ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(), acceptedAt: i.acceptedAt?.toISOString() ?? null, revokedAt: i.revokedAt?.toISOString() ?? null };
}

/** Staff: members, invitation links and joining a store; and the store's custom domain. */
export function teamRoutes(router: Router, { db, settings, resolveTxt }: AppDependencies, { withPermission }: StoreAccess): void {
  const platformHosts = [settings.adminOrigin, settings.storefrontOrigin, settings.apiOrigin].filter((x): x is string => Boolean(x)).map((o) => new URL(o).hostname);
  const lookupTxt: ResolveTxt = resolveTxt ?? (async (name) => (await import("node:dns/promises")).resolveTxt(name));

  // Members ------------------------------------------------------------------------------------

  router.patch("/stores/:storeId/members/:userId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.userId)) return problems.notFound(res);
    const body = MemberPatchSchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "members.manage", async (trx, me, userId) => {
        const target = await membersRepo.getMember(trx, req.params.userId);
        if (!target) return { kind: "not_found" };
        // Nobody manages someone above them, or promotes past themselves.
        if (!canAssignRole(me.role as StoreRole, target.role as StoreRole) || (body.data.role && !canAssignRole(me.role as StoreRole, body.data.role))) return { kind: "forbidden" };
        const losesOwner = target.role === "owner" && target.status === "active" && (body.data.status === "revoked" || (body.data.role !== undefined && body.data.role !== "owner"));
        if (losesOwner) {
          const owners = await membersRepo.lockActiveOwners(trx);
          if (owners.length <= 1) return { kind: "conflict", code: "LAST_OWNER", title: "A store needs at least one owner. Make someone else an owner first" };
        }
        if (target.userId === userId && body.data.status === "revoked") return invalid("status", "You can't remove yourself");
        await membersRepo.updateMember(trx, target.userId, { ...(body.data.role ? { role: body.data.role } : {}), ...(body.data.status ? { status: body.data.status } : {}) });
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: body.data.status === "revoked" ? "member.removed" : "member.updated", resourceType: "member", resourceId: target.userId, metadata: { ...body.data } });
        const m = (await membersRepo.getMember(trx, target.userId))!;
        return { kind: "ok", body: { member: { ...m, joinedAt: m.joinedAt.toISOString() } } };
      }),
    );
  });

  // Invitations ---------------------------------------------------------------------------------

  router.get("/stores/:storeId/invitations", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, "members.manage", async (trx) => ({ kind: "ok", body: { items: (await membersRepo.listInvitations(trx)).map(invitationJson) } })));
  });

  /** Creates a single-use link for a role. It's shown once to the inviter, and emailed when there's an address. */
  router.post("/stores/:storeId/invitations", async (req, res) => {
    const body = InviteBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "members.manage", async (trx, me, userId) => {
        if (!canAssignRole(me.role as StoreRole, body.data.role)) return invalid("role", "You can only invite people to a role at or below your own");
        const token = randomBytes(24).toString("base64url");
        const invitation = await membersRepo.createInvitation(trx, {
          storeId: req.params.storeId,
          email: body.data.email ?? null,
          role: body.data.role,
          tokenHash: hashToken(token),
          createdBy: userId,
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        });
        const url = new URL(`/invite/${token}`, settings.adminOrigin).toString();
        if (invitation.email) {
          const store = (await storesRepo.getStore(trx))!;
          const inviter = await trx.selectFrom("users").select("display_name").where("id", "=", userId).executeTakeFirst();
          await auditRepo.appendOutbox(trx, {
            id: randomUUID(),
            storeId: req.params.storeId,
            eventType: INVITATION_CREATED_V1,
            aggregateId: invitation.id,
            occurredAt: new Date(),
            // The link rides along so the email can carry it; outbox rows are readable only by the API and worker.
            payload: { invitationId: invitation.id, email: invitation.email, role: invitation.role, storeName: store.name, inviter: inviter?.display_name ?? null, url },
          });
        }
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "invitation.created", resourceType: "invitation", resourceId: invitation.id, metadata: { role: invitation.role, emailed: Boolean(invitation.email) } });
        return { kind: "ok", status: 201, body: { invitation: invitationJson(invitation), url } };
      }),
    );
  });

  router.post("/stores/:storeId/invitations/:id/revoke", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "members.manage", async (trx) => {
        const r = await membersRepo.revokeInvitation(trx, req.params.id);
        if (!r) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "invitation.revoked", resourceType: "invitation", resourceId: r.id });
        return { kind: "ok", body: { invitation: invitationJson(r) } };
      }),
    );
  });

  /** What an invitation link is for, so the invitee knows what they're joining. */
  router.get("/invitations/:token", async (req, res) => {
    if (!TOKEN.test(req.params.token)) return problems.notFound(res);
    const hash = hashToken(req.params.token);
    const storeId = await membersRepo.resolveInvitation(db, hash);
    if (!storeId) return sendProblem(res, 404, "INVITATION_INVALID", "This invitation link has expired, was revoked or was already used");
    const found = await withStore(db, storeId, async (trx) => {
      const store = await storesRepo.getStore(trx);
      const inv = await trx.selectFrom("invitations").select(["role", "email"]).where("token_hash", "=", hash).executeTakeFirst();
      return store && inv ? { storeName: store.name, role: inv.role, email: inv.email } : undefined;
    });
    if (!found) return problems.notFound(res);
    res.json({ invitation: found });
  });

  /** Joins the store with the invitation's role. An existing member keeps their role if it's higher. */
  router.post("/invitations/:token/accept", async (req, res) => {
    if (!TOKEN.test(req.params.token)) return problems.notFound(res);
    const hash = hashToken(req.params.token);
    const storeId = await membersRepo.resolveInvitation(db, hash);
    if (!storeId) return sendProblem(res, 404, "INVITATION_INVALID", "This invitation link has expired, was revoked or was already used");
    const userId = sessionOf(res).userId;
    const joined = await withContext(db, { storeId, userId }, async (trx) => {
      const accepted = await membersRepo.markInvitationAccepted(trx, hash, userId);
      if (!accepted) return undefined;
      const existing = await membersRepo.getMember(trx, userId);
      const keep = existing && existing.status === "active" && isStoreRole(existing.role) && !canAssignRole(accepted.role, existing.role as StoreRole) ? existing.role : accepted.role;
      await membersRepo.upsertMember(trx, storeId, userId, keep);
      await auditRepo.appendAudit(trx, { storeId, actor: { type: "user", id: userId }, requestId: actorOf(res).requestId, action: "invitation.accepted", resourceType: "invitation", resourceId: accepted.id, metadata: { role: keep } });
      return { storeId, role: keep };
    });
    if (!joined) return sendProblem(res, 409, "INVITATION_INVALID", "This invitation link has expired, was revoked or was already used");
    res.json(joined);
  });

  // Custom domain -------------------------------------------------------------------------------

  const domainJson = (d: Awaited<ReturnType<typeof storesRepo.getDomain>>) =>
    d
      ? {
          domain: d.domain,
          status: d.verifiedAt ? "verified" : "pending",
          verifiedAt: d.verifiedAt?.toISOString() ?? null,
          checkedAt: d.checkedAt?.toISOString() ?? null,
          txt: verificationRecord(d.domain, d.token),
          // Where to point the domain: the storefront's host.
          cname: new URL(settings.storefrontOrigin).hostname,
        }
      : null;

  router.get("/stores/:storeId/domain", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, "store.manage", async (trx) => ({ kind: "ok", body: { domain: domainJson(await storesRepo.getDomain(trx)) } })));
  });

  router.put("/stores/:storeId/domain", async (req, res) => {
    const body = DomainBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    const domain = body.data.domain;
    if (platformHosts.some((h) => domain === h || domain.endsWith(`.${h}`))) return problems.validation(res, [{ field: "domain", code: "INVALID", message: "Use a domain you own, not the platform's" }]);
    respond(
      res,
      await withPermission(res, req.params.storeId, "store.manage", async (trx) => {
        if (await storesRepo.domainTaken(trx, domain, req.params.storeId)) return { kind: "conflict", code: "DOMAIN_TAKEN", title: "Another store is already using this domain" };
        const current = await storesRepo.getDomain(trx);
        if (current?.domain !== domain) await storesRepo.setDomain(trx, domain, randomBytes(24).toString("base64url"));
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "domain.set", resourceType: "store", resourceId: req.params.storeId, metadata: { domain } });
        return { kind: "ok", body: { domain: domainJson(await storesRepo.getDomain(trx)) } };
      }),
    );
  });

  router.delete("/stores/:storeId/domain", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, "store.manage", async (trx) => {
        await storesRepo.clearDomain(trx);
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "domain.removed", resourceType: "store", resourceId: req.params.storeId });
        return { kind: "ok", body: { domain: null } };
      }),
    );
  });

  /** Looks for the verification TXT record and marks the domain verified when it's there. */
  router.post("/stores/:storeId/domain/verify", async (req, res) => {
    const current = await withPermission(res, req.params.storeId, "store.manage", async (trx) => ({ kind: "ok", body: await storesRepo.getDomain(trx) }));
    if (typeof current === "symbol" || current.kind !== "ok") return respond(res, current);
    const d = current.body;
    if (!d) return problems.notFound(res);
    const record = verificationRecord(d.domain, d.token);
    let found = false;
    try {
      found = (await lookupTxt(record.name)).some((parts) => parts.join("") === record.value);
    } catch {
      // NXDOMAIN, no TXT records or a DNS timeout all mean "not verified yet".
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "store.manage", async (trx) => {
        await storesRepo.recordDomainCheck(trx, found);
        if (found) await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "domain.verified", resourceType: "store", resourceId: req.params.storeId, metadata: { domain: d.domain } });
        const body = { domain: domainJson(await storesRepo.getDomain(trx)), found };
        return found ? { kind: "ok", body } : { kind: "conflict", code: "DOMAIN_NOT_VERIFIED", title: `We couldn't find the TXT record ${record.name} yet. DNS changes can take up to an hour; try again shortly` };
      }),
    );
  });
}
