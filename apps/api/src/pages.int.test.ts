import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Content pages: drafts stay private, published pages reach the storefront. Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let publicDb: Db;
let app: Express;
let owner: string;
let staff: string;
let storeId: string;
let slug: string;

async function newUser() {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `pages-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const s = await newUser();
  owner = o.token;
  staff = s.token;
  slug = `pages-${randomUUID().slice(0, 8)}`;
  storeId = (await as(owner, "post", "/api/v1/stores").send({ name: "Paper Kite", slug })).body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: s.id, role: "fulfillment" }).execute());
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy()]);
});

describe("content pages", () => {
  it("creates drafts with an address from the title, and keeps addresses unique", async () => {
    expect((await as(staff, "post", `${admin()}/pages`).send({ title: "About us" })).status).toBe(403);
    const about = await as(owner, "post", `${admin()}/pages`).send({ title: "About Us!", body: "We fold **kites** by hand.\n\n## Visit\n\n[Shop](/products)" });
    expect(about.status).toBe(201);
    expect(about.body.page).toMatchObject({ handle: "about-us", published: false, seoTitle: null });
    expect((await as(owner, "post", `${admin()}/pages`).send({ title: "Another", handle: "about-us" })).body.errors[0]).toMatchObject({ field: "handle", message: "Another page already uses this address" });
    expect((await as(owner, "post", `${admin()}/pages`).send({ title: "Bad", handle: "Not OK" })).status).toBe(422);
    expect((await as(owner, "get", `${admin()}/pages`)).body.items.map((p: { handle: string }) => p.handle)).toEqual(["about-us"]);
  });

  it("shows shoppers published pages only, even to a direct query from the storefront's role", async () => {
    const id = (await as(owner, "get", `${admin()}/pages`)).body.items[0].id as string;
    const shop = `/public/v1/stores/${slug}/pages/about-us`;
    expect((await request(app).get(shop)).status).toBe(404);
    const draftRows = await withStore(publicDb, storeId, (trx) => trx.selectFrom("store_pages").select(["handle", "published"]).execute());
    expect(draftRows).toEqual([]);

    const published = await as(owner, "put", `${admin()}/pages/${id}`).send({ title: "About us", handle: "about-us", body: "We fold **kites** by hand.", seoDescription: "Hand-folded paper kites.", published: true });
    expect(published.body.page).toMatchObject({ published: true, seoDescription: "Hand-folded paper kites." });
    const seen = await request(app).get(shop);
    expect(seen.body.page).toMatchObject({ handle: "about-us", title: "About us", body: "We fold **kites** by hand.", seoDescription: "Hand-folded paper kites." });
    expect(seen.body.page.id).toBeUndefined();

    const audit = JSON.stringify((await as(owner, "get", `${admin()}/audit`)).body);
    expect(audit).toContain("page.created");
    expect(audit).toContain("page.published");

    await as(owner, "put", `${admin()}/pages/${id}`).send({ title: "About us", handle: "about-us", body: "", published: false }).expect(200);
    expect((await request(app).get(shop)).status).toBe(404);
    await as(owner, "delete", `${admin()}/pages/${id}`).expect(200);
    expect((await as(owner, "get", `${admin()}/pages/${id}`)).status).toBe(404);
  });
});
