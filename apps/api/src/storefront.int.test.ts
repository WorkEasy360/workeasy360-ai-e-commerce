import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { createMailer, orderNotifyJob } from "@workeasy/mail";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Storefront browsing, cart, checkout, the shopper's order page, order admin and order email. Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

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
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `shop-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const shop = () => `/public/v1/stores/${slug}`;

const checkout = {
  deliveryEnabled: true,
  deliveryFeeMinor: 5000,
  freeDeliveryOverMinor: 100000,
  pickupEnabled: true,
  pickupAddress: "Shop 4, FC Road, Pune",
  codEnabled: true,
  codInstructions: null,
  bankEnabled: true,
  bankInstructions: "HDFC Bank · A/c 1234567890 · IFSC HDFC0000123",
  upiEnabled: true,
  upiId: "teahouse@okhdfcbank",
  upiInstructions: "Send a screenshot after paying",
  whatsappNumber: "91 98765 43210",
  telegramUsername: null,
  orderNoteEnabled: true,
};

const order = (variantId: string, extra: Record<string, unknown> = {}) => ({
  items: [{ variantId, quantity: 2 }],
  email: "Ravi@Example.com",
  name: "Ravi Kumar",
  phone: "+91 90000 00000",
  deliveryMethod: "delivery",
  address: { line1: "12 MG Road", city: "Pune", state: "MH", postalCode: "411001" },
  paymentMethod: "whatsapp",
  ...extra,
});

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  workerDb = createDb({ connectionString: urls.worker, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const a = await newUser();
  owner = o.token;
  analyst = a.token;
  slug = `tea-${randomUUID().slice(0, 8)}`;
  const store = await as(owner, "post", "/api/v1/stores").send({ name: "Tea House", slug, contactEmail: "owner@tea.test" });
  storeId = store.body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: a.id, role: "analyst" }).execute());
  const saved = await as(owner, "put", `${admin()}/checkout-settings`).send(checkout);
  if (saved.status !== 200) throw new Error(`checkout settings not saved: ${JSON.stringify(saved.body)}`);
  const tea = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Assam Tea", tags: ["tea"], variants: [{ options: [], priceMinor: 30000, stock: 3 }] });
  ids.tea = tea.body.product.variants[0].id;
  ids.teaProduct = tea.body.product.id;
  await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "draft", title: "Secret Blend", variants: [{ options: [], priceMinor: 100 }] });
  await as(owner, "post", `${admin()}/collections`).send({ title: "Teas", kind: "automated", sortOrder: "newest", rules: { match: "all", conditions: [{ field: "tag", operator: "equals", value: "tea" }] } });
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy(), workerDb.destroy()]);
});

describe("browsing", () => {
  it("shows the shop, its checkout options and only products on sale", async () => {
    const home = await request(app).get(shop());
    expect(home.body.checkout).toEqual({
      paymentMethods: ["whatsapp", "upi", "bank", "cod"],
      card: null,
      delivery: { enabled: true, feeMinor: 5000, freeOverMinor: 100000 },
      pickup: { address: "Shop 4, FC Road, Pune" },
      orderNoteEnabled: true,
    });
    expect(home.body.collections.map((c: { title: string }) => c.title)).toEqual(["Teas"]);
    expect(JSON.stringify(home.body)).not.toContain("HDFC");

    const list = await request(app).get(`${shop()}/products`);
    expect(list.body.products.map((p: { title: string }) => p.title)).toEqual(["Assam Tea"]);
    expect(list.body.products[0]).toMatchObject({ priceMin: 30000, available: true, handle: "assam-tea" });
    expect((await request(app).get(`${shop()}/products/secret-blend`)).status).toBe(404);
    expect((await request(app).get(`${shop()}/collections/teas`)).body.products).toHaveLength(1);
  });

  it("prices a cart with delivery choices and flags what can't be bought", async () => {
    const cart = await request(app).post(`${shop()}/cart`).send({ items: [{ variantId: ids.tea, quantity: 5 }, { variantId: randomUUID(), quantity: 1 }] });
    expect(cart.body.lines[0]).toMatchObject({ title: "Assam Tea", priceMinor: 30000, totalMinor: 150000, problem: "Only 3 left" });
    expect(cart.body.lines[1]).toMatchObject({ problem: "This item is no longer available" });
    expect(cart.body.deliveryOptions).toEqual(["delivery", "pickup"]);
    expect(cart.body.totals.delivery).toEqual({ subtotalMinor: 150000, discountMinor: 0, deliveryMinor: 0, taxMinor: 0, totalMinor: 150000 });
  });
});

describe("checkout", () => {
  let token = "";
  let orderId = "";

  it("places a WhatsApp order, takes stock, and gives the shopper a pre-filled chat link", async () => {
    const placed = await request(app).post(`${shop()}/orders`).send(order(ids.tea!, { note: "Gift wrap please" }));
    expect(placed.status).toBe(201);
    token = placed.body.order.token;
    const page = await request(app).get(`${shop()}/orders/${token}`);
    expect(page.body.order).toMatchObject({ number: placed.body.order.number, totalMinor: 65000, deliveryMinor: 5000, paymentStatus: "pending", email: "ravi@example.com" });
    expect(page.body.order.chat.url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(decodeURIComponent(page.body.order.chat.url)).toContain(`order #${placed.body.order.number}`);
    expect(decodeURIComponent(page.body.order.chat.url)).toContain("Note: Gift wrap please");
    expect((await request(app).get(`${shop()}/orders/${"x".repeat(32)}`)).status).toBe(404);

    const list = await as(owner, "get", `${admin()}/orders?tab=unpaid`);
    expect(list.body.items).toEqual([expect.objectContaining({ number: placed.body.order.number, name: "Ravi Kumar", totalMinor: 65000, itemCount: 2 })]);
    orderId = list.body.items[0].id;
    expect((await request(app).get(`${shop()}/products/assam-tea`)).body.product.variants[0].maxQuantity).toBe(1);
  });

  it("refuses an order the stock can't cover, explaining why", async () => {
    const r = await request(app).post(`${shop()}/orders`).send(order(ids.tea!, { paymentMethod: "bank" }));
    expect(r.status).toBe(409);
    expect(r.body.problems).toEqual([{ item: 0, code: "insufficient_stock", message: "Only 1 left in stock", available: 1 }]);
    const bad = await request(app).post(`${shop()}/orders`).send(order(ids.tea!, { address: null }));
    expect(bad.status).toBe(422);
  });

  it("emails the shopper and the store when the order is placed", async () => {
    const mailer = createMailer({ host: process.env.SMTP_HOST ?? "127.0.0.1", port: Number(process.env.SMTP_PORT ?? 1025), secure: false, from: "Tea House <orders@tea.test>" });
    const job = orderNotifyJob({ workerDb, mailer, storefrontUrl: "http://localhost:3001", adminUrl: "http://localhost:3000" });
    const dedupe = randomUUID();
    await job.handle({ id: randomUUID(), storeId, type: "orders.notify", payload: { data: { orderId, accessToken: token } }, dedupeKey: dedupe, attempt: 1, maxAttempts: 8, traceId: null, signal: new AbortController().signal });
    const mailpit = `http://127.0.0.1:${process.env.MAIL_UI_PORT ?? 8025}`;
    const found = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`message-id:${dedupe}`)}`)).json()) as { messages: Array<{ Subject: string; To: Array<{ Address: string }> }> };
    expect(found.messages.map((m) => [m.To[0]?.Address, m.Subject]).toSorted()).toEqual([
      ["owner@tea.test", expect.stringMatching(/^New order #\d+: ₹650 from Ravi Kumar$/)],
      ["ravi@example.com", expect.stringMatching(/^Order #\d+ received: Tea House$/)],
    ]);
    const detail = await as(owner, "get", `${admin()}/orders/${orderId}`);
    expect(detail.body.events.map((e: { kind: string }) => e.kind)).toEqual(["placed", "email_sent"]);
  });

  it("lets the store mark it paid and cancel with restock; analysts only read", async () => {
    expect((await as(analyst, "post", `${admin()}/orders/${orderId}/paid`)).status).toBe(403);
    const paid = await as(owner, "post", `${admin()}/orders/${orderId}/paid`);
    expect(paid.body.order).toMatchObject({ paymentStatus: "paid" });
    expect((await request(app).get(`${shop()}/orders/${token}`)).body.order.paymentInstructions).toBeNull();
    expect((await as(owner, "post", `${admin()}/orders/${orderId}/paid`)).body.code).toBe("ORDER_STATE");
    const cancelled = await as(owner, "post", `${admin()}/orders/${orderId}/cancel`).send({ restock: true });
    expect(cancelled.body.order.status).toBe("cancelled");
    expect((await request(app).get(`${shop()}/products/assam-tea`)).body.product.variants[0].maxQuantity).toBe(3);
    const summary = await as(analyst, "get", `${admin()}/sales-summary`);
    expect(summary.body).toMatchObject({ revenueMinor: 65000, paidOrders: 1, orders: 0 });
  });
});
