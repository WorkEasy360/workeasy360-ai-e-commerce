import { createStoreFixture, type StoreFixture } from "@workeasy/test-fixtures";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { withContext, withStore } from "./context.js";
import * as storesRepo from "./repositories/stores.js";
import { seedStoreFixture } from "./testing/index.js";

const urls = inject("testDatabase");

/** Asserts a PostgreSQL error by SQLSTATE. */
async function expectPgError(action: Promise<unknown>, code: string): Promise<void> {
  const err: unknown = await action.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected SQLSTATE ${code}`).toBeInstanceOf(Error);
  expect((err as { code?: string }).code).toBe(code);
}

const RLS_VIOLATION = "42501"; // insufficient_privilege: RLS WITH CHECK and missing grants

let api: Db;
let publicDb: Db;
let a: StoreFixture;
let b: StoreFixture;

beforeAll(async () => {
  api = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  a = createStoreFixture("Store A");
  b = createStoreFixture("Store B");
  await seedStoreFixture(api, a);
  await seedStoreFixture(api, b);
});

afterAll(async () => {
  await api?.destroy();
  await publicDb?.destroy();
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).toSorted();
const ownerOf = (s: StoreFixture) => s.members.find((m) => m.role === "owner")!.user;

describe("store isolation through the api role", () => {
  it("returns no store rows without a context", async () => {
    expect(await api.selectFrom("stores").select("id").where("id", "in", [a.id, b.id]).execute()).toEqual([]);
    expect(await api.selectFrom("memberships").selectAll().where("store_id", "in", [a.id, b.id]).execute()).toEqual([]);
    expect(await api.selectFrom("users").select("id").where("id", "=", ownerOf(a).id).execute()).toEqual([]);
  });

  it("shows store A only its own store, staff and users", async () => {
    await withStore(api, a.id, async (trx) => {
      expect(ids(await trx.selectFrom("stores").select("id").execute())).toEqual([a.id]);
      const memberships = await trx.selectFrom("memberships").select(["store_id", "user_id"]).execute();
      expect(memberships.map((m) => m.user_id).toSorted()).toEqual(a.members.map((m) => m.user.id).toSorted());
      expect(new Set(memberships.map((m) => m.store_id))).toEqual(new Set([a.id]));
      expect(ids(await trx.selectFrom("users").select("id").execute())).toEqual(a.members.map((m) => m.user.id).toSorted());
    });
  });

  it("cannot read or update store B from store A", async () => {
    await withStore(api, a.id, async (trx) => {
      expect(await trx.selectFrom("stores").selectAll().where("id", "=", b.id).execute()).toEqual([]);
      expect(await trx.selectFrom("users").selectAll().where("id", "=", ownerOf(b).id).execute()).toEqual([]);
    });
    const result = await withStore(api, a.id, (trx) => trx.updateTable("stores").set({ name: "hijacked" }).where("id", "=", b.id).executeTakeFirst());
    expect(result.numUpdatedRows).toBe(0n);
    const stillB = await withStore(api, b.id, (trx) => trx.selectFrom("stores").select("name").executeTakeFirstOrThrow());
    expect(stillB.name).toBe(b.name);
  });

  it("refuses to write rows for store B from store A's context", async () => {
    await expectPgError(
      withStore(api, a.id, (trx) =>
        trx.insertInto("memberships").values({ store_id: b.id, user_id: ownerOf(a).id, role: "admin" }).execute(),
      ),
      RLS_VIOLATION,
    );
    await expectPgError(
      withStore(api, a.id, (trx) =>
        trx
          .insertInto("audit_events")
          .values({ store_id: b.id, actor_type: "user", actor_id: ownerOf(a).id, action: "store.updated", resource_type: "store", resource_id: b.id })
          .execute(),
      ),
      RLS_VIOLATION,
    );
  });

  it("lets a signed-in user without a store context list only its own stores", async () => {
    const owner = ownerOf(a);
    await withContext(api, { userId: owner.id }, async (trx) => {
      expect(ids(await trx.selectFrom("stores").select("id").execute())).toEqual([a.id]);
    });
  });
});

describe("public store lookup", () => {
  it("resolves an active store by slug with only shopper-visible fields", async () => {
    const store = await storesRepo.resolvePublicStore(publicDb, a.slug);
    expect(store).toEqual({ id: a.id, slug: a.slug, name: a.name, currency: "INR", country: "IN", defaultLocale: "en" });
    expect(await storesRepo.resolvePublicStore(publicDb, "no-such-store")).toBeUndefined();
  });

  it("gives the public role no direct table access", async () => {
    await expectPgError(publicDb.selectFrom("stores").selectAll().execute(), RLS_VIOLATION);
    await expectPgError(sql`SELECT app.store_slug_taken('demo')`.execute(publicDb), RLS_VIOLATION);
  });

  it("does not resolve suspended stores", async () => {
    const c = createStoreFixture("Store C");
    await seedStoreFixture(api, c);
    // Suspension is an operator action; the superuser connection stands in for it here.
    const operator = createDb({ connectionString: urls.admin, maxConnections: 1 });
    try {
      await sql`UPDATE app.stores SET status = 'suspended' WHERE id = ${c.id}`.execute(operator);
    } finally {
      await operator.destroy();
    }
    expect(await storesRepo.resolvePublicStore(publicDb, c.slug)).toBeUndefined();
  });

  it("reports slug availability across stores to the api role", async () => {
    expect(await storesRepo.isSlugTaken(api, a.slug)).toBe(true);
    expect(await storesRepo.isSlugTaken(api, "free-slug-0000")).toBe(false);
  });
});
