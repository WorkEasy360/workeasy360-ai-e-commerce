import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/**
 * The admin assistant with the local stub model: answers from tools that run
 * as the member inside their store, proposals checked against the order and
 * carried out only through the existing endpoint, role limits, store
 * isolation and the daily allowance. Needs `pnpm infra:up`.
 */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let publicDb: Db;
let app: Express;
let owner: string;
let analyst: string;
let outsider: string;
let storeId: string;
let slug: string;
let orderNumber: number;
let orderId: string;

async function newUser() {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `assistant-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const ask = (token: string, question: string) => as(token, "post", `${admin()}/assistant`).send({ question });

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const a = await newUser();
  owner = o.token;
  analyst = a.token;
  outsider = (await newUser()).token;
  slug = `assist-${randomUUID().slice(0, 8)}`;
  storeId = (await as(owner, "post", "/api/v1/stores").send({ name: "Chai Corner", slug })).body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: a.id, role: "analyst" }).execute());
  await as(owner, "put", `${admin()}/checkout-settings`).send({
    deliveryEnabled: true, deliveryFeeMinor: 0, freeDeliveryOverMinor: null, pickupEnabled: false, pickupAddress: null,
    codEnabled: false, codInstructions: null, bankEnabled: false, bankInstructions: null, upiEnabled: true, upiId: "chai@okaxis", upiInstructions: null,
    whatsappNumber: null, telegramUsername: null, orderNoteEnabled: false,
  });
  const product = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Masala Chai", variants: [{ options: [], priceMinor: 25000, stock: 10 }] });
  const placed = await request(app)
    .post(`/public/v1/stores/${slug}/orders`)
    .send({ items: [{ variantId: product.body.product.variants[0].id, quantity: 1 }], email: "meera@example.com", name: "Meera Iyer", phone: null, deliveryMethod: "delivery", address: { line1: "4 Lake Road", city: "Chennai", state: "TN", postalCode: "600001" }, paymentMethod: "upi" });
  if (placed.status !== 201) throw new Error(`order not placed: ${JSON.stringify(placed.body)}`);
  orderNumber = placed.body.order.number;
  orderId = (await as(owner, "get", `${admin()}/orders?limit=1`)).body.items[0].id;
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy()]);
});

describe("assistant", () => {
  it("answers from this store's data using a tool", async () => {
    const r = await ask(owner, "Which orders are waiting for payment?");
    expect(r.status).toBe(200);
    expect(r.body.answer.text).toBe("I found 1 result (search_orders).");
    expect(r.body.answer.proposal).toBeNull();
    expect(r.body).toMatchObject({ usedToday: 1, dailyLimit: testSettings.assistantDailyLimit });
  });

  it("opens pages the member's role can see", async () => {
    const r = await ask(owner, "Take me to orders");
    expect(r.body.answer.link).toEqual({ label: "Orders", href: `/s/${storeId}/orders` });
    // Analysts can't open Offers, so no link is offered.
    const denied = await ask(analyst, "Take me to offers");
    expect(denied.body.answer.link).toBeNull();
  });

  it("proposes a checked change that only the existing endpoint carries out", async () => {
    const r = await ask(owner, `Order #${orderNumber} paid by UPI, I've received it`);
    expect(r.status).toBe(200);
    const p = r.body.answer.proposal;
    expect(p).toMatchObject({ kind: "mark_order_paid", danger: false, request: { method: "POST", path: `${admin()}/orders/${orderId}/paid`, body: {} } });
    expect(p.summary).toContainEqual(["Customer", "Meera Iyer"]);
    // Nothing has changed yet.
    expect((await as(owner, "get", `${admin()}/orders/${orderId}`)).body.order.paymentStatus).toBe("pending");
    const done = await as(owner, "post", p.request.path).send(p.request.body);
    expect(done.status).toBe(200);
    expect(done.body.order.paymentStatus).toBe("paid");
    // Asking again: the server re-checks the order and refuses.
    const again = await ask(owner, `Order #${orderNumber} paid by UPI, I've received it`);
    expect(again.body.answer.proposal).toBeNull();
    expect(again.body.answer.note).toMatch(/isn't awaiting payment/);
  });

  it("never offers a change to a role that can't make it", async () => {
    const r = await ask(analyst, `Order #${orderNumber} paid, received it`);
    expect(r.body.answer.proposal).toBeNull();
    expect(r.body.answer.note).toMatch(/role can't make this change/);
  });

  it("adds a product only once the member confirms, through the products endpoint", async () => {
    const r = await ask(owner, 'Add product "Ginger Tea 100 g" for ₹180, 25 in stock, make it live');
    const p = r.body.answer.proposal;
    expect(p).toMatchObject({ kind: "create_product", request: { method: "POST", path: `${admin()}/products` }, done: { path: "/products/:id", idFrom: "product" } });
    expect(p.summary).toEqual(expect.arrayContaining([["Price", "₹180.00"], ["Stock", "25"], ["Status", "Active: on sale in your shop"]]));
    expect((await as(owner, "get", `${admin()}/products?q=Ginger`)).body.items).toHaveLength(0);
    const made = await as(owner, "post", p.request.path).send(p.request.body);
    expect(made.status).toBe(201);
    expect(made.body.product).toMatchObject({ title: "Ginger Tea 100 g", status: "active", type: "physical" });
    expect(made.body.product.variants[0]).toMatchObject({ priceMinor: 18000, onHand: 25 });

    // A price change keeps everything else, stock included.
    const id = made.body.product.id as string;
    const change = await ask(owner, `Set product ${id} price to 150`);
    const u = change.body.answer.proposal;
    expect(u).toMatchObject({ kind: "update_product", request: { method: "PUT", path: `${admin()}/products/${id}` } });
    expect(u.summary).toContainEqual(["Price", "₹180.00 → ₹150.00"]);
    const saved = await as(owner, "put", u.request.path).send(u.request.body);
    expect(saved.status).toBe(200);
    expect(saved.body.product).toMatchObject({ title: "Ginger Tea 100 g", status: "active" });
    expect(saved.body.product.variants[0]).toMatchObject({ priceMinor: 15000, onHand: 25 });
    // The same change again has nothing left to do.
    expect((await ask(owner, `Set product ${id} price to 150`)).body.answer.note).toMatch(/nothing to change/);
  });

  it("creates a discount code through the offers endpoint", async () => {
    const r = await ask(owner, "Create code CHAI10 for 10% off");
    const p = r.body.answer.proposal;
    expect(p).toMatchObject({ kind: "create_discount", title: "Create code CHAI10", request: { method: "POST", path: `${admin()}/discounts` } });
    expect((await as(owner, "post", p.request.path).send(p.request.body)).status).toBe(201);
    const offers = (await as(owner, "get", `${admin()}/discounts`)).body.items as Array<{ code: string; type: string; value: number }>;
    expect(offers).toContainEqual(expect.objectContaining({ code: "CHAI10", type: "percentage", value: 1000 }));
  });

  it("refuses product tasks to roles without them", async () => {
    const r = await ask(analyst, 'Add product "Secret Blend" for ₹99');
    expect(r.body.answer.proposal).toBeNull();
    expect(r.body.answer.note).toMatch(/role can't make this change/);
  });

  it("keeps other stores' members out", async () => {
    const r = await ask(outsider, "Which orders are waiting for payment?");
    expect(r.status).toBe(404);
    expect((await as(outsider, "get", `${admin()}/assistant`)).status).toBe(404);
  });

  it("validates the question and counts a daily allowance", async () => {
    expect((await as(owner, "post", `${admin()}/assistant`).send({ question: "" })).status).toBe(422);
    const status = await as(owner, "get", `${admin()}/assistant`);
    expect(status.body.enabled).toBe(true);
    let last = 200;
    for (let i = status.body.usedToday; i <= testSettings.assistantDailyLimit!; i++) last = (await ask(owner, "Hello")).status;
    expect(last).toBe(409);
  });

  it("is unavailable when AI is off", async () => {
    const off = buildTestApp(db, unusedIdentityProvider, { ...testSettings, aiProvider: "disabled" }, publicDb);
    const r = await request(off).post(`${admin()}/assistant`).set("Cookie", `wec_session=${owner}`).set("Origin", TEST_ADMIN_ORIGIN).send({ question: "Hi" });
    expect(r.status).toBe(503);
  });
});
