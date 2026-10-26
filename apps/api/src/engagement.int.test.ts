import { randomUUID } from "node:crypto";
import { analyticsRepo, createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { RetryLaterError } from "@workeasy/jobs";
import { reviewRequestJob, type Mailer } from "@workeasy/mail";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Reviews (from buyers only, moderated, requested by email) and analytics (events, rollups, report). Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

let db: Db;
let publicDb: Db;
let workerDb: Db;
let app: Express;
let owner: string;
let analyst: string;
let storeId: string;
let slug: string;
const ids: Record<string, string> = {};

async function newUser() {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `eng-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put" | "patch" | "delete", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const shop = () => `/public/v1/stores/${slug}`;
const events = (ua: string, body: Record<string, unknown>) => request(app).post(`${shop()}/events`).set("User-Agent", ua).send(body);
const order = (email: string, quantity = 1) =>
  request(app)
    .post(`${shop()}/orders`)
    .send({ items: [{ variantId: ids.kettle, quantity }], email, name: "Priya Nair", phone: "+91 90000 33333", deliveryMethod: "delivery", address: { line1: "5 Lake Road", city: "Kochi", postalCode: "682001" }, paymentMethod: "cod" });
const orderId = async (number: number) => (await as(owner, "get", `${admin()}/orders?q=${number}`)).body.items[0].id as string;

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  workerDb = createDb({ connectionString: urls.worker, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const a = await newUser();
  owner = o.token;
  analyst = a.token;
  slug = `eng-${randomUUID().slice(0, 8)}`;
  storeId = (await as(owner, "post", "/api/v1/stores").send({ name: "Kerala Kettles", slug })).body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: a.id, role: "analyst" }).execute());
  const kettle = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Copper Kettle", variants: [{ options: [], priceMinor: 250000, stock: 20 }] });
  ids.kettle = kettle.body.product.variants[0].id;
  ids.kettleProduct = kettle.body.product.id;
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy(), workerDb.destroy()]);
});

describe("reviews", () => {
  let token = "";
  let id = "";

  it("only lets paid buyers review, and holds reviews for the merchant", async () => {
    const placed = await order("priya@example.com");
    token = placed.body.order.token;
    id = await orderId(placed.body.order.number);
    expect((await request(app).get(`${shop()}/orders/${token}`)).body.reviews).toBeNull();
    const early = await request(app).post(`${shop()}/orders/${token}/reviews`).send({ productId: ids.kettleProduct, rating: 5 });
    expect(early.body.code).toBe("CANNOT_REVIEW");

    await as(owner, "post", `${admin()}/orders/${id}/paid`).expect(200);
    expect((await request(app).get(`${shop()}/orders/${token}`)).body.reviews).toEqual([expect.objectContaining({ productId: ids.kettleProduct, title: "Copper Kettle", review: null })]);
    expect((await request(app).post(`${shop()}/orders/${token}/reviews`).send({ productId: ids.kettleProduct, rating: 0 })).status).toBe(422);
    const posted = await request(app).post(`${shop()}/orders/${token}/reviews`).send({ productId: ids.kettleProduct, rating: 4, title: "Boils fast", body: "Lovely finish.\nHandle gets warm." });
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe("pending");
    expect((await request(app).post(`${shop()}/orders/${token}/reviews`).send({ productId: ids.kettleProduct, rating: 1 })).body.code).toBe("ALREADY_REVIEWED");
    expect((await request(app).post(`${shop()}/orders/${token}/reviews`).send({ productId: randomUUID(), rating: 5 })).body.code).toBe("CANNOT_REVIEW");
    expect((await request(app).get(`${shop()}/products/copper-kettle/reviews`)).body.summary.count).toBe(0);
  });

  it("lets the merchant publish and reply, which shoppers then see", async () => {
    const queue = await as(owner, "get", `${admin()}/reviews?status=pending`);
    expect(queue.body.counts).toEqual({ pending: 1, published: 0, hidden: 0 });
    const review = queue.body.items[0];
    expect(review).toMatchObject({ authorName: "Priya N.", rating: 4, productTitle: "Copper Kettle", email: "priya@example.com" });
    expect((await as(analyst, "patch", `${admin()}/reviews/${review.id}`).send({ status: "published" })).status).toBe(403);
    await as(owner, "patch", `${admin()}/reviews/${review.id}`).send({ status: "published" }).expect(200);
    const replied = await as(owner, "patch", `${admin()}/reviews/${review.id}`).send({ reply: "Thank you! Use the wooden grip." });
    expect(replied.body.review).toMatchObject({ status: "published", reply: "Thank you! Use the wooden grip." });

    const pub = await request(app).get(`${shop()}/products/copper-kettle/reviews`);
    expect(pub.body.summary).toEqual({ average: 4, count: 1, histogram: [0, 1, 0, 0, 0] });
    expect(pub.body.reviews[0]).toMatchObject({ author: "Priya N.", title: "Boils fast", reply: "Thank you! Use the wooden grip." });
    expect(JSON.stringify(pub.body)).not.toContain("priya@example.com");
  });

  it("publishes good ratings at once when allowed, and holds low ones", async () => {
    await as(owner, "put", `${admin()}/review-settings`).send({ autoPublish: true, requestAfterDays: 3 }).expect(200);
    for (const [email, rating, expected] of [["a@example.com", 5, "published"], ["b@example.com", 2, "pending"]] as const) {
      const placed = await order(email);
      await as(owner, "post", `${admin()}/orders/${await orderId(placed.body.order.number)}/paid`).expect(200);
      const r = await request(app).post(`${shop()}/orders/${placed.body.order.token}/reviews`).send({ productId: ids.kettleProduct, rating });
      expect(r.body.status).toBe(expected);
    }
    expect((await request(app).get(`${shop()}/products/copper-kettle/reviews`)).body.summary).toMatchObject({ average: 4.5, count: 2 });
  });

  it("emails a review link a few days after fulfilment, which works without the order link", async () => {
    const placed = await order("rahul@example.com");
    const oid = await orderId(placed.body.order.number);
    await as(owner, "post", `${admin()}/orders/${oid}/paid`).expect(200);
    await as(owner, "post", `${admin()}/orders/${oid}/fulfilled`).expect(200);
    const outbox = await withStore(workerDb, storeId, (trx) => trx.selectFrom("outbox_events").select(["event_type"]).where("aggregate_id", "=", oid).execute());
    expect(outbox.map((e) => e.event_type)).toContain("review.request_due.v1");

    const sent: Array<{ to: string[]; subject: string; text: string }> = [];
    const mailer: Mailer = { send: async (m) => (sent.push(m), { ok: true }) };
    const job = reviewRequestJob({ workerDb, mailer, storefrontUrl: "http://localhost:3001", adminUrl: "http://localhost:3000" });
    const ctx = { id: randomUUID(), storeId, type: "reviews.request", payload: { data: { orderId: oid } }, dedupeKey: randomUUID(), attempt: 1, maxAttempts: 8, traceId: null, signal: new AbortController().signal };
    // Fulfilled just now; the store asks after 3 days.
    await expect(job.handle(ctx)).rejects.toBeInstanceOf(RetryLaterError);
    await withStore(db, storeId, (trx) => trx.updateTable("orders").set({ fulfilled_at: sql<Date>`now() - interval '4 days'` }).where("id", "=", oid).execute());
    await job.handle(ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["rahul@example.com"], subject: "How was your order from Kerala Kettles?" });
    const link = /http:\/\/localhost:3001\/s\/[a-z0-9-]+\/review\/([A-Za-z0-9_-]{32})/.exec(sent[0]!.text);
    expect(link).not.toBeNull();
    const reviewToken = link![1]!;

    const page = await request(app).get(`${shop()}/review-requests/${reviewToken}`);
    expect(page.body).toMatchObject({ number: placed.body.order.number, name: "Priya", items: [expect.objectContaining({ title: "Copper Kettle", review: null })] });
    const r = await request(app).post(`${shop()}/review-requests/${reviewToken}/reviews`).send({ productId: ids.kettleProduct, rating: 5, body: "Perfect chai every time" });
    expect(r.status).toBe(201);
    expect((await request(app).get(`${shop()}/review-requests/${"x".repeat(32)}`)).status).toBe(404);
  });
});

describe("analytics", () => {
  it("records anonymous visits, ignores bots, and reports the funnel, sources and sales", async () => {
    const insta = "abcdefgh1234";
    expect(
      (
        await events(BROWSER, {
          sessionId: insta,
          referrer: "https://l.instagram.com/?u=x",
          events: [
            { type: "page_view", path: `/s/${slug}?utm_campaign=x` },
            { type: "product_view", productId: ids.kettleProduct },
            { type: "add_to_cart", productId: ids.kettleProduct },
            { type: "checkout_start" },
          ],
        })
      ).status,
    ).toBe(202);
    await events(DESKTOP, { sessionId: "direct000001", events: [{ type: "page_view", path: `/s/${slug}` }, { type: "product_view", productId: ids.kettleProduct }] });
    await events(DESKTOP, { sessionId: "whatsapp0001", utmSource: "WhatsApp", events: [{ type: "page_view" }] });
    await events("Googlebot/2.1 (+http://www.google.com/bot.html)", { sessionId: "botbotbot123", events: [{ type: "page_view" }] });
    expect((await events(DESKTOP, { sessionId: "x", events: [] })).status).toBe(202);

    const stored = await withStore(workerDb, storeId, (trx) => trx.selectFrom("analytics_events").select(["session_id", "source", "device", "path"]).execute());
    expect(stored.filter((e) => e.session_id === "botbotbot123")).toEqual([]);
    expect(stored.find((e) => e.session_id === insta && e.path)).toMatchObject({ source: "Instagram", device: "mobile", path: `/s/${slug}` });

    expect((await as(owner, "get", `${admin()}/analytics?days=12`)).status).toBe(422);
    const report = await as(analyst, "get", `${admin()}/analytics?days=7`);
    expect(report.status).toBe(200);
    expect(report.body.series).toHaveLength(7);
    expect(report.body.funnel).toEqual({ visitors: 3, viewedProduct: 2, addedToCart: 1, reachedCheckout: 1, orders: 4 });
    expect(report.body.totals).toMatchObject({ orders: 4, revenueMinor: 4 * 250000, visitors: 3, averageOrderMinor: 250000, conversionRate: 4 / 3 });
    expect(report.body.sources).toEqual(expect.arrayContaining([{ source: "Instagram", visitors: 1 }, { source: "WhatsApp", visitors: 1 }, { source: "direct", visitors: 1 }]));
    expect(report.body.topProducts[0]).toMatchObject({ title: "Copper Kettle", units: 4, views: 2, addedToCart: 1 });
    expect(report.body.customers.customers).toBe(4);

    const csv = await as(owner, "get", `${admin()}/analytics.csv?days=7`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toBe("Date,Visitors,Page views,Product views,Added to cart,Reached checkout,Orders,Revenue (INR),Mobile visitors");
    expect(csv.text).toContain(",3,3,2,1,1,4,10000.00,1");
  });

  it("lets the worker find active stores and expire old events", async () => {
    expect(await analyticsRepo.activeStores(workerDb, new Date(Date.now() - 3_600_000))).toContain(storeId);
    // An event from before the retention period.
    await withStore(db, storeId, (trx) =>
      sql`INSERT INTO app.analytics_events (store_id, session_id, type, path, created_at) VALUES (${storeId}, 'oldsession01', 'page_view', '/old', now() - interval '120 days')`.execute(trx),
    );
    expect(await analyticsRepo.purgeOldEvents(workerDb)).toBeGreaterThanOrEqual(1);
    const left = await withStore(workerDb, storeId, (trx) => trx.selectFrom("analytics_events").select("session_id").where("session_id", "=", "oldsession01").execute());
    expect(left).toEqual([]);
  });
});
