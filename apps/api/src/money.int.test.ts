import { createHmac, randomUUID } from "node:crypto";
import { createDb, identityRepo, moneyRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import type { Fetch } from "@workeasy/payments";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/**
 * Card payments (Razorpay and Stripe against a fake gateway, with real
 * signatures), webhooks, refunds, shipments, invoices, customers, abandoned
 * checkouts and unpaid-order expiry. Needs `pnpm infra:up`.
 */
const urls: TestDatabaseUrls = inject("testDatabase");

const RZP = { publicKey: "rzp_test_Abc123456", secretKey: "rzp_secret_0123456789", webhookSecret: "rzp_webhook_secret_1" };
const STRIPE = { publicKey: "pk_test_0123456789", secretKey: "sk_test_0123456789", webhookSecret: "whsec_0123456789" };

/** The fake gateway: answers by method and path, and records every call. */
type Route = (body: string | undefined, url: string) => { status: number; body: unknown };
const routes = new Map<string, Route>();
const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: string | undefined }> = [];
const gateway: Fetch = async (url, init) => {
  calls.push({ method: init.method, url, headers: init.headers, body: init.body });
  const path = new URL(url).pathname;
  const route = [...routes.entries()].find(([key]) => {
    const [method, pattern] = key.split(" ") as [string, string];
    return method === init.method && new RegExp(`^${pattern}$`).test(path);
  });
  const reply = route ? route[1](init.body, url) : { status: 404, body: { error: "no route" } };
  return { status: reply.status, json: async () => reply.body };
};

let db: Db;
let publicDb: Db;
let workerDb: Db;
let app: Express;
let owner: string;
let analyst: string;
let storeId: string;
let slug: string;
let variantId: string;

async function newUser() {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `money-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const shop = () => `/public/v1/stores/${slug}`;
const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");
const onHand = async () => (await request(app).get(`${shop()}/products/masala-chai`)).body.product.variants[0].maxQuantity as number;

const cardOrder = (quantity = 2, extra: Record<string, unknown> = {}) => ({
  items: [{ variantId, quantity }],
  email: "asha@example.com",
  name: "Asha Rao",
  phone: "+91 90000 11111",
  deliveryMethod: "delivery",
  address: { line1: "7 Park Street", city: "Kolkata", postalCode: "700016" },
  paymentMethod: "card",
  ...extra,
});

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  workerDb = createDb({ connectionString: urls.worker, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb, undefined, undefined, gateway);
  const o = await newUser();
  const a = await newUser();
  owner = o.token;
  analyst = a.token;
  slug = `chai-${randomUUID().slice(0, 8)}`;
  storeId = (await as(owner, "post", "/api/v1/stores").send({ name: "Chai Co", slug, contactEmail: "owner@chai.test" })).body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: a.id, role: "analyst" }).execute());
  const product = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Masala Chai", variants: [{ options: [], priceMinor: 25000, stock: 10 }] });
  variantId = product.body.product.variants[0].id;
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy(), workerDb.destroy()]);
});

describe("connecting a gateway", () => {
  it("checks keys with the gateway, stores them encrypted and never shows them again", async () => {
    routes.set("GET /v1/orders", () => ({ status: 401, body: { error: { code: "BAD_REQUEST_ERROR" } } }));
    const refused = await as(owner, "put", `${admin()}/payment-accounts/razorpay`).send(RZP);
    expect(refused.status).toBe(422);
    expect(refused.body.errors[0].message).toContain("didn't accept these keys");
    expect((await as(owner, "put", `${admin()}/payment-accounts/razorpay`).send({ ...RZP, publicKey: "key_live_123456" })).status).toBe(422);
    expect((await as(analyst, "put", `${admin()}/payment-accounts/razorpay`).send(RZP)).status).toBe(403);

    routes.set("GET /v1/orders", () => ({ status: 200, body: { items: [] } }));
    const saved = await as(owner, "put", `${admin()}/payment-accounts/razorpay`).send(RZP);
    expect(saved.status).toBe(200);
    expect(saved.body.account).toMatchObject({ provider: "razorpay", mode: "test", publicKey: RZP.publicKey, secretKeyHint: "••••••6789", enabled: true });

    const list = await as(analyst, "get", `${admin()}/payment-accounts`);
    expect(list.body.webhookUrls.razorpay).toBe(`${TEST_ADMIN_ORIGIN}/webhooks/razorpay/${storeId}`);
    const everything = JSON.stringify(list.body) + JSON.stringify(await withStore(db, storeId, (trx) => trx.selectFrom("payment_accounts").selectAll().execute()));
    expect(everything).not.toContain(RZP.secretKey);
    expect(everything).not.toContain(RZP.webhookSecret);
    const audit = await as(owner, "get", `${admin()}/audit`);
    expect(JSON.stringify(audit.body)).not.toContain(RZP.secretKey);
  });

  it("offers card first at checkout once connected", async () => {
    const home = await request(app).get(shop());
    expect(home.body.checkout.paymentMethods[0]).toBe("card");
    expect(home.body.checkout.card).toEqual({ provider: "razorpay" });
    expect(JSON.stringify(home.body)).not.toContain("rzp_");
  });
});

describe("paying with Razorpay", () => {
  let token = "";
  let orderId = "";
  let rzpOrderId = "";

  it("places a card order, holds stock and opens Razorpay Checkout", async () => {
    routes.set("POST /v1/orders", (body) => ({ status: 200, body: { id: `order_${randomUUID().slice(0, 8)}`, amount: JSON.parse(body!).amount, currency: "INR", status: "created" } }));
    const placed = await request(app).post(`${shop()}/orders`).send(cardOrder());
    expect(placed.status).toBe(201);
    token = placed.body.order.token;
    expect(placed.body.payment).toMatchObject({ provider: "razorpay", keyId: RZP.publicKey, amountMinor: 50000, currency: "INR", prefill: { email: "asha@example.com" } });
    rzpOrderId = placed.body.payment.razorpayOrderId;
    const rzpCall = calls.findLast((c) => c.url.endsWith("/v1/orders") && c.method === "POST")!;
    expect(JSON.parse(rzpCall.body!)).toMatchObject({ amount: 50000, currency: "INR" });
    expect(rzpCall.headers.authorization).toBe(`Basic ${Buffer.from(`${RZP.publicKey}:${RZP.secretKey}`).toString("base64")}`);

    const page = await request(app).get(`${shop()}/orders/${token}`);
    expect(page.body.order).toMatchObject({ paymentMethod: "card", paymentStatus: "pending", paymentInstructions: null });
    expect(Date.parse(page.body.order.payBy)).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(await onHand()).toBe(8);

    // Reopening the payment reuses the same Razorpay order.
    const again = await request(app).post(`${shop()}/orders/${token}/pay`);
    expect(again.body.payment.razorpayOrderId).toBe(rzpOrderId);
    orderId = (await as(owner, "get", `${admin()}/orders?tab=unpaid`)).body.items[0].id;
  });

  it("confirms the payment only with Razorpay's signature", async () => {
    const forged = await request(app).post(`${shop()}/orders/${token}/payments/razorpay`).send({ razorpayOrderId: rzpOrderId, paymentId: "pay_1", signature: "a".repeat(64) });
    expect(forged.status).toBe(400);
    const signature = hmac(RZP.secretKey, `${rzpOrderId}|pay_1`);
    const ok = await request(app).post(`${shop()}/orders/${token}/payments/razorpay`).send({ razorpayOrderId: rzpOrderId, paymentId: "pay_1", signature });
    expect(ok.body).toEqual({ status: "paid" });
    expect((await request(app).post(`${shop()}/orders/${token}/payments/razorpay`).send({ razorpayOrderId: rzpOrderId, paymentId: "pay_1", signature })).body).toEqual({ status: "paid" });
    const detail = await as(owner, "get", `${admin()}/orders/${orderId}`);
    expect(detail.body.order).toMatchObject({ paymentStatus: "paid", paymentDueAt: null });
    expect(detail.body.payments).toEqual([expect.objectContaining({ provider: "razorpay", status: "succeeded", providerPaymentId: "pay_1", amountMinor: 50000, mode: "test" })]);
    expect(detail.body.events.filter((e: { kind: string }) => e.kind === "paid")).toHaveLength(1);
    expect((await request(app).post(`${shop()}/orders/${token}/pay`)).body.code).toBe("NOTHING_TO_PAY");
  });

  it("accepts signed webhooks once and refuses unsigned ones", async () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: rzpOrderId, amount: 50000, currency: "INR", method: "upi" } } } });
    const send = (signature: string, eventId: string) =>
      request(app).post(`/webhooks/razorpay/${storeId}`).set("content-type", "application/json").set("x-razorpay-signature", signature).set("x-razorpay-event-id", eventId).send(body);
    expect((await send(hmac("wrong", body), "evt_1")).status).toBe(400);
    expect((await send(hmac(RZP.webhookSecret, body), "evt_1")).body).toEqual({ received: true });
    expect((await send(hmac(RZP.webhookSecret, body), "evt_1")).body).toEqual({ received: true, duplicate: true });
    expect((await request(app).post(`/webhooks/razorpay/${randomUUID()}`).send(body)).status).toBe(404);
  });

  it("refunds part to the card with restock, then the rest by hand, and no more", async () => {
    routes.set("POST /v1/payments/pay_1/refund", (body) => ({ status: 200, body: { id: "rfnd_1", status: "processed", amount: JSON.parse(body!).amount } }));
    const detail = await as(owner, "get", `${admin()}/orders/${orderId}`);
    const itemId = detail.body.items[0].id;
    expect((await as(analyst, "post", `${admin()}/orders/${orderId}/refunds`).send({ amountMinor: 100, method: "gateway" })).status).toBe(403);

    const part = await as(owner, "post", `${admin()}/orders/${orderId}/refunds`).send({ amountMinor: 25000, method: "gateway", reason: "One tin arrived dented", restock: [{ orderItemId: itemId, quantity: 1 }] });
    expect(part.status).toBe(201);
    expect(part.body.order).toMatchObject({ paymentStatus: "partially_refunded", refundedMinor: 25000 });
    expect(part.body.refunds).toEqual([expect.objectContaining({ amountMinor: 25000, status: "succeeded", providerRefundId: "rfnd_1", restocked: true })]);
    expect(part.body.refundableMinor).toBe(25000);
    expect(calls.findLast((c) => c.url.includes("/refund"))!.body).toContain('"amount":25000');
    expect(await onHand()).toBe(9);

    expect((await as(owner, "post", `${admin()}/orders/${orderId}/refunds`).send({ amountMinor: 30000, method: "manual" })).status).toBe(422);
    const rest = await as(owner, "post", `${admin()}/orders/${orderId}/refunds`).send({ amountMinor: 25000, method: "manual" });
    expect(rest.body.order).toMatchObject({ paymentStatus: "refunded", refundedMinor: 50000 });
    expect(rest.body.refundableMinor).toBe(0);
  });

  it("ships in parts with tracking, which the shopper sees", async () => {
    const detail = await as(owner, "get", `${admin()}/orders/${orderId}`);
    const itemId = detail.body.items[0].id;
    const first = await as(owner, "post", `${admin()}/orders/${orderId}/fulfillments`).send({
      items: [{ orderItemId: itemId, quantity: 1 }],
      carrier: "Delhivery",
      trackingNumber: "DL123456",
      trackingUrl: "https://www.delhivery.com/track/package/DL123456",
    });
    expect(first.status).toBe(201);
    expect(first.body.order.fulfillmentStatus).toBe("partially_fulfilled");
    expect(first.body.items[0].unfulfilledQuantity).toBe(1);
    expect((await as(owner, "post", `${admin()}/orders/${orderId}/fulfillments`).send({ items: [{ orderItemId: itemId, quantity: 2 }] })).body.code).toBe("ORDER_STATE");
    expect((await as(owner, "post", `${admin()}/orders/${orderId}/fulfillments`).send({ items: [{ orderItemId: itemId, quantity: 1 }], trackingUrl: "http://insecure.test" })).status).toBe(422);
    const second = await as(owner, "post", `${admin()}/orders/${orderId}/fulfillments`).send({ items: [{ orderItemId: itemId, quantity: 1 }], notify: false });
    expect(second.body.order.fulfillmentStatus).toBe("fulfilled");
    expect(second.body.fulfillments).toHaveLength(2);

    const page = await request(app).get(`${shop()}/orders/${token}`);
    expect(page.body.order.shipments[0]).toMatchObject({ carrier: "Delhivery", trackingNumber: "DL123456", units: 1 });
    const notices = await withStore(workerDb, storeId, (trx) => trx.selectFrom("outbox_events").select("event_type").where("aggregate_id", "=", orderId).execute());
    expect(notices.filter((n) => n.event_type === "order.fulfilled.v1")).toHaveLength(1);
  });

  it("downloads an invoice as PDF", async () => {
    const pdf = await as(owner, "get", `${admin()}/orders/${orderId}/invoice.pdf`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const text = (pdf.body as Buffer).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(INVOICE)");
    expect(text).toContain("(Masala Chai)");
    expect(text).toContain("INR 500.00");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("unpaid card orders", () => {
  it("are cancelled after the payment window, releasing stock", async () => {
    const before = await onHand();
    const placed = await request(app).post(`${shop()}/orders`).send(cardOrder(3));
    expect(await onHand()).toBe(before - 3);
    await withStore(db, storeId, (trx) => trx.updateTable("orders").set({ payment_due_at: sql<Date>`now() - interval '1 minute'` }).where("number", "=", placed.body.order.number).execute());
    expect(await moneyRepo.expireCardOrders(workerDb)).toBeGreaterThanOrEqual(1);
    const page = await request(app).get(`${shop()}/orders/${placed.body.order.token}`);
    expect(page.body.order).toMatchObject({ status: "cancelled", payBy: null });
    expect(await onHand()).toBe(before);
    const payments = await withStore(db, storeId, (trx) => trx.selectFrom("payments as p").innerJoin("orders as o", "o.id", "p.order_id").select("p.status").where("o.number", "=", placed.body.order.number).execute());
    expect(payments.map((p) => p.status)).toEqual(["failed"]);
  });
});

describe("unreadable gateway keys", () => {
  it("make card payments unavailable instead of failing the order", async () => {
    // As if the keys were saved under a different SECRETS_ENCRYPTION_KEY.
    const saved = await withStore(db, storeId, (trx) => trx.selectFrom("payment_accounts").select("secret_key_enc").where("provider", "=", "razorpay").executeTakeFirstOrThrow());
    await withStore(db, storeId, (trx) => trx.updateTable("payment_accounts").set({ secret_key_enc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA" }).where("provider", "=", "razorpay").execute());
    const placed = await request(app).post(`${shop()}/orders`).send(cardOrder(1));
    expect(placed.status).toBe(201);
    expect(placed.body.payment).toEqual({ error: "Card payments aren't available in this shop right now" });
    await withStore(db, storeId, (trx) => trx.updateTable("payment_accounts").set({ secret_key_enc: saved.secret_key_enc }).where("provider", "=", "razorpay").execute());
  });
});

describe("paying with Stripe", () => {
  it("sends the shopper to Stripe Checkout and confirms on the signed webhook", async () => {
    await as(owner, "delete", `${admin()}/payment-accounts/razorpay`).expect(200);
    routes.set("GET /v1/balance", () => ({ status: 200, body: { available: [] } }));
    expect((await as(owner, "put", `${admin()}/payment-accounts/stripe`).send({ ...STRIPE, publicKey: "pk_live_0123456789" })).status).toBe(422);
    expect((await as(owner, "put", `${admin()}/payment-accounts/stripe`).send(STRIPE)).status).toBe(200);
    expect((await request(app).get(shop())).body.checkout.card).toEqual({ provider: "stripe" });

    routes.set("POST /v1/checkout/sessions", (body) => {
      const p = new URLSearchParams(body);
      return { status: 200, body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", status: "open", payment_status: "unpaid", amount_total: Number(p.get("line_items[0][price_data][unit_amount]")), currency: "inr", payment_intent: null } };
    });
    const placed = await request(app).post(`${shop()}/orders`).send(cardOrder(1));
    expect(placed.body.payment).toEqual({ provider: "stripe", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const session = new URLSearchParams(calls.findLast((c) => c.url.endsWith("/checkout/sessions"))!.body);
    expect(session.get("success_url")).toBe(`http://localhost:3001/s/${slug}/order/${placed.body.order.token}?paid=stripe`);

    const event = JSON.stringify({
      id: "evt_stripe_1",
      type: "checkout.session.completed",
      data: { object: { object: "checkout.session", id: "cs_test_1", status: "complete", payment_status: "paid", amount_total: 25000, currency: "inr", payment_intent: "pi_1" } },
    });
    const t = Math.floor(Date.now() / 1000);
    const post = (sig: string) => request(app).post(`/webhooks/stripe/${storeId}`).set("content-type", "application/json").set("stripe-signature", sig).send(event);
    expect((await post(`t=${t - 3600},v1=${hmac(STRIPE.webhookSecret, `${t - 3600}.${event}`)}`)).status).toBe(400);
    expect((await post(`t=${t},v1=${hmac(STRIPE.webhookSecret, `${t}.${event}`)}`)).body).toEqual({ received: true });
    const page = await request(app).get(`${shop()}/orders/${placed.body.order.token}`);
    expect(page.body.order.paymentStatus).toBe("paid");
  });
});

describe("customers, checkouts and finances", () => {
  it("lists customers with their orders and spend", async () => {
    const list = await as(owner, "get", `${admin()}/customers?q=asha`);
    expect(list.body.items).toEqual([expect.objectContaining({ name: "Asha Rao", email: "asha@example.com" })]);
    const one = await as(owner, "get", `${admin()}/customers/${list.body.items[0].id}`);
    expect(one.body.orders.length).toBe(4);
    expect(one.body.customer.spentMinor).toBe(25000);
  });

  it("shows checkouts left without an order, and forgets them once ordered", async () => {
    const saved = await request(app).post(`${shop()}/checkouts`).send({ email: "neha@example.com", name: "Neha", items: [{ variantId, quantity: 2 }] });
    const checkoutId = saved.body.checkoutId;
    expect((await request(app).post(`${shop()}/checkouts`).send({ checkoutId, email: "neha@example.com", name: "Neha S", items: [{ variantId, quantity: 1 }] })).body.checkoutId).toBe(checkoutId);
    // Fresh checkouts aren't abandoned yet; one left idle is.
    expect((await as(analyst, "get", `${admin()}/checkouts/abandoned`)).body.items).toEqual([]);
    const idle = await withStore(db, storeId, (trx) => moneyRepo.abandonedCheckouts(trx, { idleMs: 0 }));
    expect(idle).toEqual([expect.objectContaining({ email: "neha@example.com", name: "Neha S", subtotalMinor: 25000, items: [expect.objectContaining({ title: "Masala Chai", quantity: 1 })] })]);
    await request(app).post(`${shop()}/orders`).send(cardOrder(1, { email: "neha@example.com", name: "Neha S", paymentMethod: "cod", checkoutId }));
    expect(await withStore(db, storeId, (trx) => moneyRepo.abandonedCheckouts(trx, { idleMs: 0 }))).toEqual([]);
  });

  it("summarises takings and lists payments and refunds", async () => {
    const cod = (await as(owner, "get", `${admin()}/orders?tab=unpaid&q=neha`)).body.items[0];
    await as(owner, "post", `${admin()}/orders/${cod.id}/paid`).expect(200);
    const fin = await as(analyst, "get", `${admin()}/finances`);
    expect(fin.status).toBe(200);
    // Test-mode card payments are listed but not counted as takings.
    expect(fin.body.summary).toMatchObject({ collectedMinor: 25000, byProvider: { manual: { totalMinor: 25000, count: 1 } }, currency: "INR" });
    expect(fin.body.entries.map((e: { kind: string; provider: string }) => `${e.kind}:${e.provider}`)).toEqual(
      expect.arrayContaining(["payment:manual", "payment:stripe", "payment:razorpay", "refund:razorpay", "refund:manual"]),
    );
  });
});
