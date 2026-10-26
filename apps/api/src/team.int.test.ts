import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Staff invitations, roles, and custom domains (against a fake DNS). Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

const dns = new Map<string, string[][]>();
const resolveTxt = async (name: string) => {
  const found = dns.get(name);
  if (!found) throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
  return found;
};

let db: Db;
let publicDb: Db;
let workerDb: Db;
let app: Express;
const users: Record<string, { id: string; token: string }> = {};
let storeId: string;
let slug: string;

async function newUser(name: string) {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `team-${randomUUID()}`, displayName: name });
  users[name] = { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
  return users[name];
}
const as = (who: string, method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
  request(app)[method](path).set("Cookie", `wec_session=${users[who]!.token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const tokenOf = (url: string) => url.split("/invite/")[1]!;

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  workerDb = createDb({ connectionString: urls.worker, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb, undefined, undefined, undefined, resolveTxt);
  for (const name of ["Owner", "Anita", "Bala", "Chitra", "Outsider"]) await newUser(name);
  slug = `team-${randomUUID().slice(0, 8)}`;
  storeId = (await as("Owner", "post", "/api/v1/stores").send({ name: "Silk House", slug })).body.store.id;
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy(), workerDb.destroy()]);
});

describe("invitations", () => {
  it("invites by link, emails it when there's an address, and lets the invitee join once", async () => {
    const created = await as("Owner", "post", `${admin()}/invitations`).send({ email: "anita@example.com", role: "admin" });
    expect(created.status).toBe(201);
    expect(created.body.url).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{32}$/);
    const token = tokenOf(created.body.url);
    const outbox = await withStore(workerDb, storeId, (trx) => trx.selectFrom("outbox_events").select(["event_type", "payload"]).where("aggregate_id", "=", created.body.invitation.id).execute());
    expect(outbox).toEqual([expect.objectContaining({ event_type: "invitation.created.v1" })]);
    expect(JSON.stringify(outbox[0]!.payload)).toContain("Silk House");
    // Only a hash of the token is stored.
    const stored = await withStore(db, storeId, (trx) => trx.selectFrom("invitations").select("token_hash").execute());
    expect(stored.some((r) => r.token_hash.toString("base64url") === token)).toBe(false);

    expect((await request(app).get(`/api/v1/invitations/${token}`)).status).toBe(401);
    expect((await as("Anita", "get", `/api/v1/invitations/${token}`)).body.invitation).toEqual({ storeName: "Silk House", role: "admin", email: "anita@example.com" });
    expect((await as("Anita", "get", `${admin()}/products`)).status).toBe(404);
    const joined = await as("Anita", "post", `/api/v1/invitations/${token}/accept`);
    expect(joined.body).toEqual({ storeId, role: "admin" });
    expect((await as("Anita", "get", `${admin()}/products`)).status).toBe(200);
    expect((await as("Bala", "post", `/api/v1/invitations/${token}/accept`)).body.code).toBe("INVITATION_INVALID");
    expect((await as("Owner", "get", `${admin()}/invitations`)).body.items[0].status).toBe("accepted");
  });

  it("keeps invitations within the inviter's own role, and revoked links stop working", async () => {
    expect((await as("Anita", "post", `${admin()}/invitations`).send({ role: "owner" })).body.errors[0].message).toBe("You can only invite people to a role at or below your own");
    const staffLink = await as("Anita", "post", `${admin()}/invitations`).send({ role: "staff" });
    expect(staffLink.status).toBe(201);
    await as("Anita", "post", `${admin()}/invitations/${staffLink.body.invitation.id}/revoke`).expect(200);
    expect((await as("Bala", "get", `/api/v1/invitations/${tokenOf(staffLink.body.url)}`)).body.code).toBe("INVITATION_INVALID");
    const fresh = await as("Anita", "post", `${admin()}/invitations`).send({ role: "fulfillment" });
    expect((await as("Bala", "post", `/api/v1/invitations/${tokenOf(fresh.body.url)}/accept`)).body.role).toBe("fulfillment");
    expect((await as("Bala", "post", `${admin()}/invitations`).send({ role: "analyst" })).status).toBe(403);
  });

  it("doesn't lower someone's role through an invitation", async () => {
    const link = await as("Owner", "post", `${admin()}/invitations`).send({ role: "analyst" });
    expect((await as("Anita", "post", `/api/v1/invitations/${tokenOf(link.body.url)}/accept`)).body.role).toBe("admin");
  });
});

describe("roles", () => {
  it("changes roles and removes people within the manager's authority, and always keeps an owner", async () => {
    const owner = users.Owner!.id;
    const bala = users.Bala!.id;
    expect((await as("Anita", "patch", `${admin()}/members/${owner}`).send({ role: "staff" })).status).toBe(403);
    expect((await as("Anita", "patch", `${admin()}/members/${bala}`).send({ role: "owner" })).status).toBe(403);
    expect((await as("Anita", "patch", `${admin()}/members/${bala}`).send({ role: "staff" })).body.member.role).toBe("staff");
    expect((await as("Owner", "patch", `${admin()}/members/${owner}`).send({ role: "admin" })).body.code).toBe("LAST_OWNER");
    expect((await as("Owner", "patch", `${admin()}/members/${owner}`).send({ status: "revoked" })).status).not.toBe(200);
    await as("Anita", "patch", `${admin()}/members/${bala}`).send({ status: "revoked" }).expect(200);
    expect((await as("Bala", "get", `${admin()}/products`)).status).toBe(404);
    const audit = await as("Owner", "get", `${admin()}/audit`);
    expect(JSON.stringify(audit.body)).toContain("member.removed");
  });
});

describe("custom domains", () => {
  it("claims a domain, verifies it over DNS, and only then serves the shop on it", async () => {
    expect((await as("Anita", "put", `${admin()}/domain`).send({ domain: "shop.silkhouse.in" })).status).toBe(403);
    expect((await as("Owner", "put", `${admin()}/domain`).send({ domain: "not a domain" })).status).toBe(422);
    expect((await as("Owner", "put", `${admin()}/domain`).send({ domain: "shop.localhost" })).status).toBe(422);
    const claimed = await as("Owner", "put", `${admin()}/domain`).send({ domain: "https://Shop.SilkHouse.in/" });
    expect(claimed.body.domain).toMatchObject({ domain: "shop.silkhouse.in", status: "pending", cname: "localhost", txt: { name: "_workeasy360.shop.silkhouse.in" } });
    const record = claimed.body.domain.txt as { name: string; value: string };

    expect((await request(app).get("/public/v1/domains/shop.silkhouse.in")).status).toBe(404);
    expect((await request(app).get("/public/v1/domains/check?domain=shop.silkhouse.in")).status).toBe(404);
    const early = await as("Owner", "post", `${admin()}/domain/verify`);
    expect(early.body.code).toBe("DOMAIN_NOT_VERIFIED");

    dns.set(record.name, [["some-other=value"], [record.value.slice(0, 20), record.value.slice(20)]]);
    const verified = await as("Owner", "post", `${admin()}/domain/verify`);
    expect(verified.body.domain).toMatchObject({ status: "verified" });
    expect((await request(app).get("/public/v1/domains/shop.silkhouse.in")).body).toEqual({ slug });
    expect((await request(app).get("/public/v1/domains/check?domain=SHOP.silkhouse.in")).status).toBe(200);

    // Another store can't take it.
    const other = (await as("Outsider", "post", "/api/v1/stores").send({ name: "Copycat", slug: `copy-${randomUUID().slice(0, 8)}` })).body.store.id;
    expect((await as("Outsider", "put", `/api/v1/stores/${other}/domain`).send({ domain: "shop.silkhouse.in" })).body.code).toBe("DOMAIN_TAKEN");

    await as("Owner", "delete", `${admin()}/domain`).expect(200);
    expect((await request(app).get("/public/v1/domains/shop.silkhouse.in")).status).toBe(404);
  });
});
