import { randomUUID } from "node:crypto";
import { createDb, identityRepo, type Db } from "@workeasy/database";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { AuditListResponseSchema, MeResponseSchema, PublicStoreResponseSchema, StoreResponseSchema } from "./contract/schemas.js";
import { buildTestApp, cookieFrom, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Store creation, settings and isolation through the HTTP API. Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let publicDb: Db;
let app: Express;

async function newSession(): Promise<string> {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `stores-${randomUUID()}` });
  return (await identityRepo.createSession(db, id, 60 * 60 * 1000)).token;
}

const as = (token: string, method: "get" | "post" | "patch", path: string) =>
  request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);

const uniqueSlug = () => `shop-${randomUUID().slice(0, 8)}`;

async function createStore(token: string, overrides: Record<string, unknown> = {}) {
  const res = await as(token, "post", "/api/v1/stores").send({ name: "Chai & Co", slug: uniqueSlug(), ...overrides });
  expect(res.status).toBe(201);
  return StoreResponseSchema.parse(res.body);
}

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy()]);
});

describe("POST /api/v1/stores", () => {
  it("creates a store owned by the caller with sensible defaults", async () => {
    const token = await newSession();
    const slug = uniqueSlug();
    const created = await createStore(token, { name: "  Chai & Co  ", slug: slug.toUpperCase() });
    expect(created.store).toMatchObject({ name: "Chai & Co", slug, currency: "INR", country: "IN", defaultLocale: "en", status: "active" });
    expect(created.role).toBe("owner");
    expect(created.permissions).toContain("store.manage");

    const me = MeResponseSchema.parse((await as(token, "get", "/api/v1/me")).body);
    expect(me.stores).toEqual([expect.objectContaining({ id: created.store.id, slug, role: "owner" })]);

    const audit = AuditListResponseSchema.parse((await as(token, "get", `/api/v1/stores/${created.store.id}/audit`)).body);
    expect(audit.entries.map((e) => e.action)).toEqual(["store.created"]);
  });

  it("refuses taken, reserved and malformed addresses", async () => {
    const token = await newSession();
    const first = await createStore(token);
    const taken = await as(token, "post", "/api/v1/stores").send({ name: "Copy", slug: first.store.slug });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("SLUG_TAKEN");
    expect((await as(token, "post", "/api/v1/stores").send({ name: "X", slug: "admin" })).status).toBe(422);
    expect((await as(token, "post", "/api/v1/stores").send({ name: "X", slug: "-bad-" })).status).toBe(422);
    expect((await as(token, "post", "/api/v1/stores").send({ name: "   ", slug: uniqueSlug() })).status).toBe(422);
  });

  it("reports address availability", async () => {
    const token = await newSession();
    const store = await createStore(token);
    expect((await as(token, "get", `/api/v1/store-slugs/${store.store.slug}`)).body).toMatchObject({ available: false });
    expect((await as(token, "get", `/api/v1/store-slugs/${uniqueSlug()}`)).body).toMatchObject({ available: true });
    expect((await as(token, "get", "/api/v1/store-slugs/checkout")).body).toMatchObject({ available: false });
  });

  it("requires a session and the admin origin", async () => {
    expect((await request(app).post("/api/v1/stores").set("Origin", TEST_ADMIN_ORIGIN).send({ name: "X", slug: uniqueSlug() })).status).toBe(401);
    const token = await newSession();
    const res = await request(app)
      .post("/api/v1/stores")
      .set("Cookie", `wec_session=${token}`)
      .set("Origin", "https://evil.example")
      .send({ name: "X", slug: uniqueSlug() });
    expect(res.status).toBe(403);
  });
});

describe("store access", () => {
  it("hides a store from non-members", async () => {
    const owner = await newSession();
    const other = await newSession();
    const { store } = await createStore(owner);
    expect((await as(other, "get", `/api/v1/stores/${store.id}`)).status).toBe(404);
    expect((await as(other, "patch", `/api/v1/stores/${store.id}`).send({ name: "Hijacked" })).status).toBe(404);
    expect((await as(other, "get", `/api/v1/stores/not-a-uuid`)).status).toBe(404);
    expect(MeResponseSchema.parse((await as(other, "get", "/api/v1/me")).body).stores).toEqual([]);
  });

  it("updates settings and records which fields changed", async () => {
    const token = await newSession();
    const { store } = await createStore(token);
    const newSlug = uniqueSlug();
    const res = await as(token, "patch", `/api/v1/stores/${store.id}`).send({ name: "Chai Two", currency: "usd", slug: newSlug, contactEmail: "Hello@Example.com" });
    expect(res.status).toBe(200);
    expect(StoreResponseSchema.parse(res.body).store).toMatchObject({ name: "Chai Two", currency: "USD", slug: newSlug, contactEmail: "hello@example.com" });
    const audit = AuditListResponseSchema.parse((await as(token, "get", `/api/v1/stores/${store.id}/audit?action=store.updated`)).body);
    expect(audit.entries[0]?.metadata).toEqual({ fields: ["contactEmail", "currency", "name", "slug"], slug: { before: store.slug, after: newSlug } });
    expect(JSON.stringify(audit.entries)).not.toContain("hello@example.com");
  });
});

describe("GET /public/v1/stores/:slug", () => {
  it("serves an active store's public details without any session", async () => {
    const token = await newSession();
    const { store } = await createStore(token, { currency: "EUR", country: "DE", defaultLocale: "de" });
    const res = await request(app).get(`/public/v1/stores/${store.slug}`);
    expect(res.status).toBe(200);
    expect(PublicStoreResponseSchema.parse(res.body)).toEqual({
      store: { slug: store.slug, name: store.name, currency: "EUR", country: "DE", defaultLocale: "de" },
    });
    expect(res.body.store.id).toBeUndefined();
    expect((await request(app).get("/public/v1/stores/no-such-store")).status).toBe(404);
  });
});

describe("password sign-up", () => {
  it("opens an admin session with the commerce cookie", async () => {
    const res = await request(app)
      .post("/auth/password/signup")
      .set("Origin", TEST_ADMIN_ORIGIN)
      .send({ email: `owner-${randomUUID()}@example.com`, password: "correct horse battery", name: "Owner" });
    expect(res.status).toBe(200);
    expect(cookieFrom(res.headers["set-cookie"], "wec_session")).toBeDefined();
  });
});
