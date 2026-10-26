import { sql, type Selectable, type Transaction } from "kysely";
import type { Db } from "../client.js";
import type { Database, MembershipRole, MembershipStatus, StoresTable, StoreStatus } from "../schema.js";

/**
 * Store-scoped queries. Every function taking a transaction runs under
 * withContext/withStore, so row security already limits it to one store.
 */
type Trx = Transaction<Database>;

export interface MembershipRecord {
  role: MembershipRole;
  status: MembershipStatus;
}

export async function getMembership(trx: Trx, userId: string): Promise<MembershipRecord | undefined> {
  return trx.selectFrom("memberships").select(["role", "status"]).where("user_id", "=", userId).executeTakeFirst();
}

export interface StoreRecord {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  currency: string;
  country: string;
  defaultLocale: string;
  timezone: string;
  contactEmail: string | null;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toStore(r: Selectable<StoresTable>): StoreRecord {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    currency: r.currency,
    country: r.country,
    defaultLocale: r.default_locale,
    timezone: r.timezone,
    contactEmail: r.contact_email,
    settings: r.settings,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The store of the current context. */
export async function getStore(trx: Trx): Promise<StoreRecord | undefined> {
  const row = await trx.selectFrom("stores").selectAll().executeTakeFirst();
  return row ? toStore(row) : undefined;
}

export interface NewStoreInput {
  /** The new store's id; the transaction must already be scoped to it. */
  storeId: string;
  slug: string;
  name: string;
  currency: string;
  country: string;
  defaultLocale: string;
  timezone: string;
  contactEmail: string | null;
  homeRegion: string;
  ownerId: string;
}

/** Self-serve store creation: the creator becomes its only owner. */
export async function createStore(trx: Trx, input: NewStoreInput): Promise<StoreRecord> {
  const row = await trx
    .insertInto("stores")
    .values({
      id: input.storeId,
      slug: input.slug,
      name: input.name,
      currency: input.currency,
      country: input.country,
      default_locale: input.defaultLocale,
      timezone: input.timezone,
      contact_email: input.contactEmail,
      home_region: input.homeRegion,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx.insertInto("memberships").values({ store_id: input.storeId, user_id: input.ownerId, role: "owner" }).execute();
  return toStore(row);
}

/** Fields to change; absent or undefined fields are left as they are. */
export interface StorePatch {
  name?: string | undefined;
  slug?: string | undefined;
  currency?: string | undefined;
  country?: string | undefined;
  defaultLocale?: string | undefined;
  timezone?: string | undefined;
  contactEmail?: string | null | undefined;
}

export async function updateStore(trx: Trx, patch: StorePatch): Promise<StoreRecord | undefined> {
  const row = await trx
    .updateTable("stores")
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.slug === undefined ? {} : { slug: patch.slug }),
      ...(patch.currency === undefined ? {} : { currency: patch.currency }),
      ...(patch.country === undefined ? {} : { country: patch.country }),
      ...(patch.defaultLocale === undefined ? {} : { default_locale: patch.defaultLocale }),
      ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
      ...(patch.contactEmail === undefined ? {} : { contact_email: patch.contactEmail }),
    })
    .returningAll()
    .executeTakeFirst();
  return row ? toStore(row) : undefined;
}

/** Whether any store uses the slug. Runs without a store context. */
export async function isSlugTaken(db: Db | Trx, slug: string): Promise<boolean> {
  const { rows } = await sql<{ taken: boolean }>`SELECT app.store_slug_taken(${slug}) AS taken`.execute(db);
  return rows[0]?.taken === true;
}

/** True for a unique violation on the global slug constraint (a concurrent create or rename won). */
export function isSlugCollision(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === "stores_slug_key";
}

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  currency: string;
  country: string;
  defaultLocale: string;
}

/** An active store by slug, as shoppers see it. Runs as the public role without a context. */
export async function resolvePublicStore(publicDb: Db, slug: string): Promise<PublicStore | undefined> {
  const { rows } = await sql<{ id: string; slug: string; name: string; currency: string; country: string; default_locale: string }>`
    SELECT id, slug, name, currency, country, default_locale FROM app.resolve_public_store(${slug})`.execute(publicDb);
  const r = rows[0];
  return r ? { id: r.id, slug: r.slug, name: r.name, currency: r.currency, country: r.country, defaultLocale: r.default_locale } : undefined;
}

// Custom domains --------------------------------------------------------------------------------

export interface DomainState {
  domain: string;
  token: string;
  verifiedAt: Date | null;
  checkedAt: Date | null;
}

export async function getDomain(trx: Trx): Promise<DomainState | undefined> {
  const r = await trx.selectFrom("stores").select(["custom_domain", "domain_token", "domain_verified_at", "domain_checked_at"]).executeTakeFirst();
  return r?.custom_domain && r.domain_token ? { domain: r.custom_domain, token: r.domain_token, verifiedAt: r.domain_verified_at, checkedAt: r.domain_checked_at } : undefined;
}

/** Whether another store has claimed the domain. */
export async function domainTaken(trx: Trx, domain: string, storeId: string): Promise<boolean> {
  const { rows } = await sql<{ taken: boolean }>`SELECT app.store_domain_taken(${domain}, ${storeId}::uuid) AS taken`.execute(trx);
  return rows[0]?.taken ?? false;
}

/** Claims a domain for the store, unverified, with a fresh verification token. */
export async function setDomain(trx: Trx, domain: string, token: string): Promise<void> {
  await trx.updateTable("stores").set({ custom_domain: domain, domain_token: token, domain_verified_at: null, domain_checked_at: null }).execute();
}

export async function clearDomain(trx: Trx): Promise<void> {
  await trx.updateTable("stores").set({ custom_domain: null, domain_token: null, domain_verified_at: null, domain_checked_at: null }).execute();
}

export async function recordDomainCheck(trx: Trx, verified: boolean): Promise<void> {
  await trx
    .updateTable("stores")
    .set({ domain_checked_at: sql<Date>`now()`, ...(verified ? { domain_verified_at: sql<Date>`coalesce(domain_verified_at, now())` } : { domain_verified_at: null }) })
    .execute();
}

/** The shop slug for a verified domain; runs before any store context exists. */
export async function resolveDomain(db: Db, host: string): Promise<string | undefined> {
  const { rows } = await sql<{ slug: string }>`SELECT slug FROM app.resolve_store_domain(${host.toLowerCase()})`.execute(db);
  return rows[0]?.slug;
}
