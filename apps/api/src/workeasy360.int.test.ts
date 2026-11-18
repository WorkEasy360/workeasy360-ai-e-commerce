import { randomUUID } from "node:crypto";
import { createDb, identityRepo, workeasy360Repo, type Db } from "@workeasy/database";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { MeResponseSchema } from "./contract/schemas.js";
import { buildTestApp, cookieFrom, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";
import { FakeWorkeasy360, type ClientKeys } from "./workeasy360/fake-provider.js";
import type { AnswerStore } from "./workeasy360/entitlements.js";
import { createWorkeasy360Runtime, type Workeasy360Runtime } from "./workeasy360/runtime.js";

/**
 * WorkEasy360 Accounts sign-in to the merchant admin against a fake provider
 * built here (keys are generated when it starts): the contract's checks, the
 * organization that owns stores, entitlement, back-channel logout across two
 * API instances, sign-out and the migration safety rules. Needs `pnpm infra:up`
 * for PostgreSQL.
 */
const urls = inject("testDatabase");

const CLIENT_ID = "commerce-client-test";
const REDIRECT_URI = `${TEST_ADMIN_ORIGIN}/auth/workeasy360/callback`;
const POST_LOGOUT_URI = `${TEST_ADMIN_ORIGIN}/?signed_out=1`;

let db: Db;
let ownerDb: Db;
let publicDb: Db;
let fake: FakeWorkeasy360;
let keys: ClientKeys;
/** Two API instances sharing one database, as in production behind a load balancer. */
let app: Express;
let other: Express;
let runtime: Workeasy360Runtime;

function makeRuntime(overrides: { ssoOnly?: boolean; provisionStores?: boolean; now?: () => number; store?: AnswerStore } = {}) {
  return createWorkeasy360Runtime(
    db,
    {
      issuer: fake.issuer,
      clientId: CLIENT_ID,
      productCode: "ai_commerce",
      redirectUri: REDIRECT_URI,
      keyId: keys.keyId,
      privateKeyPem: keys.privateKeyPem,
      scopes: ["openid", "email", "profile", "organization"],
      allowInsecureRequests: true,
    },
    {
      postLogoutRedirectUri: POST_LOGOUT_URI,
      ssoOnly: overrides.ssoOnly ?? false,
      defaultRole: "staff",
      provisionStores: overrides.provisionStores ?? true,
      purchaseUrl: `${fake.issuer}/products/ai_commerce`,
    },
    { store: overrides.store, cacheNow: overrides.now },
  );
}

function makeApp(w360: Workeasy360Runtime): Express {
  return buildTestApp(db, unusedIdentityProvider, testSettings, publicDb, undefined, undefined, undefined, undefined, w360);
}

interface SignedIn {
  res: request.Response;
  /** `wec_session=<token>`, or undefined when the sign-in failed. */
  cookie: string | undefined;
  location: string;
}

/** Drives the browser: start, the provider's authorization endpoint, the callback. */
async function signIn(target: Express = app, options: { organization?: string; cookie?: string; replay?: boolean } = {}): Promise<SignedIn> {
  const start = await request(target).get(`/auth/workeasy360/start${options.organization ? `?organization=${options.organization}` : ""}`);
  expect(start.status).toBe(302);
  const flowCookie = cookieFrom(start.headers["set-cookie"], "wec_w360_flow")!;
  expect(flowCookie).toBeDefined();
  const authorize = await fetch(start.headers.location as string, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const back = new URL(authorize.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(REDIRECT_URI);
  const call = () => request(target).get(back.pathname + back.search).set("Cookie", [flowCookie, ...(options.cookie ? [options.cookie] : [])].join("; "));
  let res = await call();
  if (options.replay) res = await call();
  return { res, cookie: cookieFrom(res.headers["set-cookie"], "wec_session"), location: String(res.headers.location ?? "") };
}

function ssoError(signedIn: SignedIn): string | null {
  return new URL(signedIn.location, TEST_ADMIN_ORIGIN).searchParams.get("sso_error");
}

const me = (target: Express, cookie: string) => request(target).get("/api/v1/me").set("Cookie", cookie);
const store = (target: Express, cookie: string, storeId: string) => request(target).get(`/api/v1/stores/${storeId}`).set("Cookie", cookie);
const backchannel = (target: Express, token: string) =>
  request(target).post("/auth/workeasy360/backchannel-logout").type("form").send({ logout_token: token });
const slug = () => `w360-${randomUUID().slice(0, 8)}`;

/** Creates a store through the admin API, as the session's person. */
async function createStore(target: Express, cookie: string, name = "Asha's shop") {
  return request(target).post("/api/v1/stores").set("Cookie", cookie).set("Origin", TEST_ADMIN_ORIGIN).send({ name, slug: slug() });
}

function newPerson(overrides: Partial<FakeWorkeasy360["person"]> = {}) {
  fake.person = {
    sub: randomUUID(),
    email: `person.${randomUUID().slice(0, 8)}@example.test`,
    emailVerified: true,
    name: "Asha Person",
    organizationId: randomUUID(),
    organizationName: "Asha's organization",
    sid: randomUUID(),
    ...overrides,
  };
  return fake.person;
}

/** A person signed in to a new organization that then created its first store. */
async function organizationWithStore(target: Express = app) {
  const person = fake.person;
  const signedIn = await signIn(target);
  const created = await createStore(target, signedIn.cookie!);
  expect(created.status).toBe(201);
  return { person, cookie: signedIn.cookie!, storeId: created.body.store.id as string };
}

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 6 });
  ownerDb = createDb({ connectionString: urls.owner, maxConnections: 2 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  fake = await FakeWorkeasy360.start();
  keys = await fake.registerClient(CLIENT_ID, [REDIRECT_URI]);
  runtime = makeRuntime();
  app = makeApp(runtime);
  other = makeApp(makeRuntime());
});

afterAll(async () => {
  await fake?.stop();
  await Promise.all([db?.destroy(), ownerDb?.destroy(), publicDb?.destroy()]);
});

beforeEach(() => {
  newPerson();
  fake.tampering = {};
  fake.entitlement = (organizationId) => ({
    status: 200,
    body: { decision: "allow", reason: "entitled", product_code: "ai_commerce", organization_id: organizationId, write_allowed: true, revalidate_after: 900 },
  });
});

describe("WorkEasy360 sign-in to the admin: the happy path", () => {
  it("signs in with PKCE S256 and private_key_jwt; the organization's first person creates its first store", async () => {
    const person = fake.person;
    const done = await signIn(app, { organization: person.organizationId! });
    expect(done.res.status).toBe(303);
    expect(done.cookie).toBeDefined();
    const setCookies = ([] as string[]).concat(done.res.headers["set-cookie"] ?? []);
    expect(setCookies.find((c) => c.startsWith("wec_session="))).toMatch(/HttpOnly/);
    expect(setCookies.find((c) => c.startsWith("wec_w360_flow="))).toMatch(/Max-Age=0/);
    // No store yet: the admin's "create your store" step.
    expect(done.location).toBe(`${TEST_ADMIN_ORIGIN}/`);

    const authorize = fake.seen.authorize.at(-1)!;
    expect(authorize.get("code_challenge_method")).toBe("S256");
    expect(authorize.get("organization")).toBe(person.organizationId);
    expect(authorize.get("scope")).toBe("openid email profile organization");
    const exchange = fake.seen.token.at(-1)!;
    expect(exchange.form.get("client_secret")).toBeNull();
    expect(exchange.assertion).toMatchObject({ iss: CLIENT_ID, sub: CLIENT_ID, aud: fake.tokenEndpoint });
    expect(exchange.assertion.exp! - exchange.assertion.iat!).toBe(60);
    const entitlement = fake.seen.entitlement.at(-1)!;
    expect(entitlement.form.get("organization_id")).toBe(person.organizationId);
    expect(entitlement.form.get("subject")).toBe(person.sub);

    const profile = MeResponseSchema.parse((await me(app, done.cookie!)).body);
    expect(profile.stores).toEqual([]);
    expect(profile.session).toEqual({ provider: "workeasy360", workeasy360SignOut: true });

    const created = await createStore(app, done.cookie!);
    expect(created.status).toBe(201);
    const storeId = created.body.store.id as string;
    expect(await workeasy360Repo.organizationStores(db, person.organizationId!)).toEqual([{ storeId, status: "active" }]);
    expect((await store(app, done.cookie!, storeId)).body).toMatchObject({ role: "owner" });

    // Next time, straight to the store.
    expect((await signIn()).location).toBe(`${TEST_ADMIN_ORIGIN}/s/${storeId}`);
  });

  it("gives the next person of the organization the default role in its stores, keyed on (issuer, sub)", async () => {
    const { storeId, cookie: ownerCookie, person } = await organizationWithStore();
    newPerson({ organizationId: person.organizationId, email: person.email });
    const second = await signIn();
    expect(second.location).toBe(`${TEST_ADMIN_ORIGIN}/s/${storeId}`);
    expect((await store(app, second.cookie!, storeId)).body).toMatchObject({ role: "staff" });
    expect(MeResponseSchema.parse((await me(app, second.cookie!)).body).user.id).not.toBe(MeResponseSchema.parse((await me(app, ownerCookie)).body).user.id);
    // Only an owner of one of the organization's stores adds another store.
    expect((await createStore(app, second.cookie!)).status).toBe(403);
    expect((await createStore(app, ownerCookie, "Second shop")).status).toBe(201);
  });

  it("ends the session the browser already held when someone signs in over it", async () => {
    const first = await signIn();
    newPerson();
    const second = await signIn(app, { cookie: first.cookie! });
    expect(second.res.status).toBe(303);
    expect((await me(app, first.cookie!)).status).toBe(401);
    expect((await me(app, second.cookie!)).status).toBe(200);
  });

  it("reports WorkEasy360 as a sign-in method", async () => {
    expect((await request(app).get("/auth/methods")).body).toMatchObject({ password: true, workeasy360: true, workeasy360PurchaseUrl: `${fake.issuer}/products/ai_commerce` });
  });
});

describe("WorkEasy360 sign-in to the admin: what is refused", () => {
  it.each([
    ["another issuer", { issuer: "https://accounts.example.test" }],
    ["another audience", { audience: "some-other-product" }],
    ["a signature the key set does not verify", { foreignKey: true }],
    ["another nonce", { nonce: "a-nonce-from-another-browser-0000" }],
    ["an access token", { typ: "access_token" }],
  ])("refuses an ID token with %s", async (_label, tampering) => {
    fake.tampering = tampering;
    const done = await signIn();
    expect(ssoError(done)).toBe("invalid_token");
    expect(done.cookie).toBeUndefined();
  });

  it("verifies the ID token's signature against the provider's key set itself", async () => {
    const nonce = "n0nce-n0nce-n0nce-n0nce-n0nce-n0nce-n0nce";
    const claims = { sub: randomUUID(), nonce, typ: "id_token", product_code: "ai_commerce", organization_id: randomUUID(), email: "direct@example.test", email_verified: true };
    await expect(runtime.client.verifyIdToken(await fake.signIdToken(CLIENT_ID, claims), nonce)).resolves.toMatchObject({ subject: claims.sub });
    await expect(runtime.client.verifyIdToken(await fake.signIdToken(CLIENT_ID, claims, { foreignKey: true }), nonce)).rejects.toMatchObject({ code: "invalid_token" });
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ ...claims, iss: fake.issuer, aud: CLIENT_ID, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url"),
      "",
    ].join(".");
    await expect(runtime.client.verifyIdToken(unsigned, nonce)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("refuses a callback with no pending flow, with another state, and a flow used twice", async () => {
    const start = await request(app).get("/auth/workeasy360/start");
    const flowCookie = cookieFrom(start.headers["set-cookie"], "wec_w360_flow")!;
    const authorize = await fetch(start.headers.location as string, { redirect: "manual" });
    const back = new URL(authorize.headers.get("location")!);
    const noFlow = await request(app).get(back.pathname + back.search);
    expect(new URL(noFlow.headers.location as string).searchParams.get("sso_error")).toBe("expired");
    const forged = new URL(back);
    forged.searchParams.set("state", "a-state-this-browser-never-had-000000");
    const wrongState = await request(app).get(forged.pathname + forged.search).set("Cookie", flowCookie);
    expect(new URL(wrongState.headers.location as string).searchParams.get("sso_error")).toBe("expired");
    const afterwards = await request(app).get(back.pathname + back.search).set("Cookie", flowCookie);
    expect(new URL(afterwards.headers.location as string).searchParams.get("sso_error")).toBe("expired");
    expect(cookieFrom(afterwards.headers["set-cookie"], "wec_session")).toBeUndefined();
    expect(ssoError(await signIn(app, { replay: true }))).toBe("expired");
  });

  it("refuses a token for another product, with no organization, or an unverified address", async () => {
    fake.tampering = { productCode: "workeasy_forms" };
    expect(ssoError(await signIn())).toBe("wrong_product");
    newPerson({ organizationId: undefined });
    expect(ssoError(await signIn())).toBe("no_organization");
    newPerson({ emailVerified: false });
    expect(ssoError(await signIn())).toBe("email_unverified");
  });

  it("refuses a token for another organization than the launcher asked for", async () => {
    fake.tampering = { claims: { organization_id: randomUUID() } };
    expect(ssoError(await signIn(app, { organization: randomUUID() }))).toBe("wrong_organization");
  });

  it("refuses an organization that is not entitled, with a purchase page and no session", async () => {
    fake.entitlement = () => ({ status: 200, body: { decision: "deny", reason: "not_entitled", revalidate_after: 900 } });
    const done = await signIn();
    const target = new URL(done.location);
    expect(target.searchParams.get("sso_error")).toBe("not_entitled");
    expect(target.searchParams.get("reason")).toBe("not_entitled");
    expect(done.cookie).toBeUndefined();
    fake.authorizeError = "product_not_entitled";
    expect(ssoError(await signIn())).toBe("not_entitled");
  });
});

describe("WorkEasy360 organizations and stores", () => {
  it("never lets a session reach a store of an organization its token did not name", async () => {
    const a = await organizationWithStore();
    const person = a.person;
    // The same person, through another WorkEasy360 organization with its own store.
    fake.person = { ...person, organizationId: randomUUID(), sid: randomUUID() };
    const b = await organizationWithStore();
    expect((await store(app, a.cookie, a.storeId)).status).toBe(200);
    expect((await store(app, a.cookie, b.storeId)).status).toBe(404);
    expect((await store(app, b.cookie, a.storeId)).status).toBe(404);
    expect(MeResponseSchema.parse((await me(app, a.cookie)).body).stores.map((s) => s.id)).toEqual([a.storeId]);
    expect(MeResponseSchema.parse((await me(app, b.cookie)).body).stores.map((s) => s.id)).toEqual([b.storeId]);
  });

  it("lands an organization whose store the operator linked in that store, and keeps a removed member out", async () => {
    const signUp = await request(app)
      .post("/auth/password/signup")
      .set("Origin", TEST_ADMIN_ORIGIN)
      .send({ email: `owner.${randomUUID().slice(0, 8)}@example.test`, password: "a long password" });
    const ownerCookie = cookieFrom(signUp.headers["set-cookie"], "wec_session")!;
    const legacy = await createStore(app, ownerCookie, "Legacy shop");
    expect(legacy.status).toBe(201);
    const storeId = legacy.body.store.id as string;
    const organizationId = fake.person.organizationId!;
    expect(await workeasy360Repo.linkStore(ownerDb, storeId, organizationId)).toMatchObject({ changed: true, storeName: "Legacy shop" });

    const done = await signIn();
    expect(done.location).toBe(`${TEST_ADMIN_ORIGIN}/s/${storeId}`);
    const joined = MeResponseSchema.parse((await me(app, done.cookie!)).body);
    expect(joined.stores).toEqual([expect.objectContaining({ id: storeId, role: "staff" })]);
    // The password owner still works (not SSO-only), now under the organization's entitlement.
    expect((await store(app, ownerCookie, storeId)).status).toBe(200);

    const removed = await request(app)
      .patch(`/api/v1/stores/${storeId}/members/${joined.user.id}`)
      .set("Cookie", ownerCookie)
      .set("Origin", TEST_ADMIN_ORIGIN)
      .send({ status: "revoked" });
    expect(removed.status).toBe(200);
    expect(ssoError(await signIn())).toBe("membership_revoked");
    await expect(workeasy360Repo.linkStore(ownerDb, storeId, randomUUID())).rejects.toThrow(/already belongs/);
  });

  it("does not let an organization without stores in when its people may not create them", async () => {
    expect(ssoError(await signIn(makeApp(makeRuntime({ provisionStores: false }))))).toBe("no_store");
  });

  it("refuses an invitation to a store of another organization", async () => {
    const a = await organizationWithStore();
    const invite = await request(app).post(`/api/v1/stores/${a.storeId}/invitations`).set("Cookie", a.cookie).set("Origin", TEST_ADMIN_ORIGIN).send({ role: "staff" });
    expect(invite.status).toBe(201);
    const token = new URL(invite.body.url as string).pathname.split("/").at(-1)!;
    newPerson();
    const elsewhere = await signIn();
    const accept = await request(app).post(`/api/v1/invitations/${token}/accept`).set("Cookie", elsewhere.cookie!).set("Origin", TEST_ADMIN_ORIGIN);
    expect(accept.status).toBe(403);
    expect(accept.body.code).toBe("WORKEASY360_OTHER_ORGANIZATION");
  });
});

describe("WorkEasy360 entitlement on its schedule", () => {
  it("re-asks after revalidate_after, ends access on a denial, keeps the last answer through an outage and fails closed on a refusal of the client", async () => {
    let clock = Date.now();
    const memory = new Map<string, string>();
    const answers: AnswerStore = { get: async (k) => memory.get(k) ?? null, set: async (k, v) => void memory.set(k, v) };
    const timed = makeApp(makeRuntime({ now: () => clock, store: answers }));
    let reply = { status: 200, body: { decision: "allow", reason: "entitled", write_allowed: true, revalidate_after: 60 } as Record<string, unknown> };
    fake.entitlement = () => reply;
    const { cookie, storeId } = await organizationWithStore(timed);
    const asked = () => fake.seen.entitlement.length;

    const before = asked();
    expect((await store(timed, cookie, storeId)).status).toBe(200);
    expect(asked()).toBe(before);

    reply = { status: 200, body: { decision: "allow", reason: "entitled", write_allowed: false, revalidate_after: 60 } };
    clock += 61_000;
    expect((await store(timed, cookie, storeId)).status).toBe(200);
    expect(asked()).toBe(before + 1);
    const write = await request(timed).patch(`/api/v1/stores/${storeId}`).set("Cookie", cookie).set("Origin", TEST_ADMIN_ORIGIN).send({ name: "Renamed" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("WORKEASY360_READ_ONLY");

    reply = { status: 200, body: { decision: "deny", reason: "expired", revalidate_after: 60 } };
    clock += 61_000;
    const ended = await store(timed, cookie, storeId);
    expect(ended.status).toBe(403);
    expect(ended.body).toMatchObject({ code: "WORKEASY360_ACCESS_ENDED", reason: "expired" });

    reply = { status: 503, body: { error: "temporarily_unavailable" } };
    clock += 61_000;
    expect((await store(timed, cookie, storeId)).status).toBe(403);

    reply = { status: 200, body: { decision: "allow", reason: "entitled", write_allowed: true, revalidate_after: 60 } };
    clock += 61_000;
    expect((await store(timed, cookie, storeId)).status).toBe(200);

    reply = { status: 401, body: { error: "invalid_client" } };
    clock += 61_000;
    const refused = await store(timed, cookie, storeId);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("WORKEASY360_ACCESS_UNVERIFIED");
    const afterRefusal = asked();
    reply = { status: 200, body: { decision: "allow", reason: "entitled", write_allowed: true, revalidate_after: 60 } };
    clock += 10_000;
    expect((await store(timed, cookie, storeId)).status).toBe(403);
    expect(asked()).toBe(afterRefusal);
    clock += 61_000;
    expect((await store(timed, cookie, storeId)).status).toBe(200);
  });

  it("keeps an outage at arrival from locking anyone out", async () => {
    fake.entitlement = () => ({ status: 503, body: { error: "temporarily_unavailable" } });
    const done = await signIn(makeApp(makeRuntime({ store: { get: async () => null, set: async () => undefined } })));
    expect(done.cookie).toBeDefined();
  });
});

describe("WorkEasy360 back-channel logout", () => {
  it("ends the session a sid names at once on both instances, and answers a duplicate with 200", async () => {
    const done = await signIn(app);
    expect((await me(other, done.cookie!)).status).toBe(200);
    const token = await fake.logoutToken(CLIENT_ID, { sid: fake.person.sid, sub: fake.person.sub });
    const res = await backchannel(other, token);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await me(app, done.cookie!)).status).toBe(401);
    expect((await me(other, done.cookie!)).status).toBe(401);
    expect((await backchannel(app, token)).status).toBe(200);
  });

  it("ends every session of the person when the token names sub only, and leaves other people alone", async () => {
    const person = fake.person;
    const one = await signIn(app);
    fake.person = { ...person, sid: randomUUID() };
    const two = await signIn(other);
    newPerson();
    const bystander = await signIn(app);
    expect((await backchannel(app, await fake.logoutToken(CLIENT_ID, { sub: person.sub }))).status).toBe(200);
    expect((await me(app, one.cookie!)).status).toBe(401);
    expect((await me(other, two.cookie!)).status).toBe(401);
    expect((await me(other, bystander.cookie!)).status).toBe(200);
  });

  it("refuses forged and malformed logout tokens with 400 and ends nothing", async () => {
    const done = await signIn();
    const { sub, sid } = fake.person;
    const forged = [
      await fake.logoutToken(CLIENT_ID, { sid, sub, foreignKey: true }),
      await fake.logoutToken(CLIENT_ID, { sid, sub, issuer: "https://accounts.example.test" }),
      await fake.logoutToken(CLIENT_ID, { sid, sub, audience: "some-other-product" }),
      await fake.logoutToken(CLIENT_ID, { sid, sub, typ: "JWT" }),
      await fake.logoutToken(CLIENT_ID, { sid, sub, withoutEvent: true }),
      await fake.logoutToken(CLIENT_ID, { sid, sub, nonce: "an-id-token-nonce" }),
      await fake.logoutToken(CLIENT_ID, {}),
      await fake.logoutToken(CLIENT_ID, { sid, sub, issuedAt: Math.floor(Date.now() / 1000) - 3600 }),
      "not-a-jwt",
    ];
    for (const token of forged) expect((await backchannel(app, token)).status, token.slice(0, 40)).toBe(400);
    expect((await request(app).post("/auth/workeasy360/backchannel-logout").type("form").send({ token: "x" })).status).toBe(400);
    expect((await request(app).post("/auth/workeasy360/backchannel-logout").send({ logout_token: await fake.logoutToken(CLIENT_ID, { sid, sub }) })).status).toBe(400);
    expect((await me(app, done.cookie!)).status).toBe(200);
  });

  it("accepts each jti once: a replayed jti for a new session ends nothing", async () => {
    const jti = randomUUID();
    const first = await signIn();
    expect((await backchannel(app, await fake.logoutToken(CLIENT_ID, { sub: fake.person.sub, jti }))).status).toBe(200);
    expect((await me(app, first.cookie!)).status).toBe(401);
    const again = await signIn();
    expect((await backchannel(app, await fake.logoutToken(CLIENT_ID, { sub: fake.person.sub, jti }))).status).toBe(200);
    expect((await me(app, again.cookie!)).status).toBe(200);
  });
});

describe("signing out", () => {
  it("ends only the admin session, or also sends the browser to WorkEasy360's end_session_endpoint", async () => {
    const local = await signIn();
    const out = await request(app).post("/auth/logout").set("Cookie", local.cookie!).set("Origin", TEST_ADMIN_ORIGIN);
    expect(out.status).toBe(303);
    expect(out.headers.location).toBe(`${TEST_ADMIN_ORIGIN}/`);
    expect((await me(app, local.cookie!)).status).toBe(401);

    const both = await signIn();
    const everywhere = await request(app).post("/auth/logout?workeasy360=1").set("Cookie", both.cookie!).set("Origin", TEST_ADMIN_ORIGIN);
    expect(everywhere.status).toBe(303);
    const target = new URL(everywhere.headers.location as string);
    expect(target.origin + target.pathname).toBe(`${fake.issuer}/api/v1/integrations/oauth/logout`);
    expect(target.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(POST_LOGOUT_URI);
    expect(target.searchParams.get("id_token_hint")).toMatch(/^ey/);
    expect((await me(app, both.cookie!)).status).toBe(401);
  });
});

describe("migration safety", () => {
  it("keeps password sign-in working when not SSO-only, and refuses it and its sessions when SSO-only", async () => {
    const email = `legacy.${randomUUID().slice(0, 8)}@example.test`;
    const signUp = await request(app).post("/auth/password/signup").set("Origin", TEST_ADMIN_ORIGIN).send({ email, password: "a long password" });
    expect(signUp.status).toBe(200);
    const cookie = cookieFrom(signUp.headers["set-cookie"], "wec_session")!;
    expect((await me(app, cookie)).status).toBe(200);

    const ssoOnly = makeApp(makeRuntime({ ssoOnly: true }));
    const login = await request(ssoOnly).post("/auth/password/login").set("Origin", TEST_ADMIN_ORIGIN).send({ email, password: "a long password" });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("PASSWORD_SIGN_IN_DISABLED");
    const refused = await me(ssoOnly, cookie);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe("WORKEASY360_SIGN_IN_REQUIRED");
    expect((await request(ssoOnly).get("/auth/methods")).body).toMatchObject({ password: false, sso: false, workeasy360: true });
    const done = await signIn(ssoOnly);
    expect((await me(ssoOnly, done.cookie!)).status).toBe(200);
  });

  it("refuses to split a person whose subject exists under another issuer, until the identity move runs", async () => {
    const oldIssuer = `${fake.issuer}/old-name`;
    const oldUserId = await identityRepo.findOrCreateUser(db, { issuer: oldIssuer, subject: fake.person.sub });
    expect(ssoError(await signIn())).toBe("identity_conflict");
    expect(await workeasy360Repo.moveIssuer(ownerDb, oldIssuer, fake.issuer, false)).toMatchObject({ movable: 1, conflicts: [], applied: false });
    expect((await workeasy360Repo.moveIssuer(ownerDb, oldIssuer, fake.issuer, true)).applied).toBe(true);
    const done = await signIn();
    expect(MeResponseSchema.parse((await me(app, done.cookie!)).body).user.id).toBe(oldUserId);
  });

  it("refuses an issuer move that would merge two accounts", async () => {
    const oldIssuer = `${fake.issuer}/older-name`;
    const subject = randomUUID();
    for (const issuer of [oldIssuer, fake.issuer]) await identityRepo.findOrCreateUser(db, { issuer, subject });
    const plan = await workeasy360Repo.moveIssuer(ownerDb, oldIssuer, fake.issuer, true);
    expect(plan.applied).toBe(false);
    expect(plan.conflicts).toEqual([expect.objectContaining({ subject })]);
  });

  it("re-keys an existing account to a WorkEasy360 identity when an operator vouches for it", async () => {
    const signUp = await request(app)
      .post("/auth/password/signup")
      .set("Origin", TEST_ADMIN_ORIGIN)
      .send({ email: `vouched.${randomUUID().slice(0, 8)}@example.test`, password: "a long password" });
    const passwordCookie = cookieFrom(signUp.headers["set-cookie"], "wec_session")!;
    const userId = MeResponseSchema.parse((await me(app, passwordCookie)).body).user.id;
    await workeasy360Repo.linkUserIdentity(ownerDb, userId, fake.issuer, fake.person.sub);
    const done = await signIn();
    expect(MeResponseSchema.parse((await me(app, done.cookie!)).body).user.id).toBe(userId);
  });
});
