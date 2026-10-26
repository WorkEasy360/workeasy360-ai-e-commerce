import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Offers, shipping zones, tax, bookings and digital downloads, end to end through the API. Needs `pnpm infra:up`. */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let publicDb: Db;
let app: Express;
let owner: string;
let ownerId: string;
let staff: string;
let storeId: string;
let slug: string;
const ids: Record<string, string> = {};

async function newUser() {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `rules-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 3_600_000)).token };
}
const as = (token: string, method: "get" | "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const shop = () => `/public/v1/stores/${slug}`;

const buyer = (extra: Record<string, unknown> = {}) => ({
  email: "isha@example.com",
  name: "Isha Patel",
  phone: "+91 90000 22222",
  deliveryMethod: "delivery",
  address: { line1: "3 Hill Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
  paymentMethod: "bank",
  ...extra,
});
const tins = (quantity: number) => [{ variantId: ids.tea!, quantity }];
const quote = (body: Record<string, unknown>) => request(app).post(`${shop()}/cart`).send(body);
const place = (body: Record<string, unknown>) => request(app).post(`${shop()}/orders`).send(body);
const orderIdOf = async (number: number) => (await as(owner, "get", `${admin()}/orders?q=${number}`)).body.items[0].id as string;

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const s = await newUser();
  owner = o.token;
  ownerId = o.id;
  staff = s.token;
  slug = `rules-${randomUUID().slice(0, 8)}`;
  storeId = (await as(owner, "post", "/api/v1/stores").send({ name: "Spice Route", slug })).body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: s.id, role: "fulfillment" }).execute());
  await as(owner, "put", `${admin()}/checkout-settings`).send({
    deliveryEnabled: true,
    deliveryFeeMinor: 5000,
    freeDeliveryOverMinor: null,
    pickupEnabled: false,
    pickupAddress: null,
    codEnabled: true,
    codInstructions: null,
    bankEnabled: true,
    bankInstructions: "HDFC · 1234",
    upiEnabled: false,
    upiId: null,
    upiInstructions: null,
    whatsappNumber: null,
    telegramUsername: null,
    orderNoteEnabled: true,
  });
  const tea = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Kashmiri Kahwa", taxRateBps: 500, variants: [{ options: [], priceMinor: 40000, stock: 50, weightGrams: 300 }] });
  ids.tea = tea.body.product.variants[0].id;
  ids.teaProduct = tea.body.product.id;
  const mug = await as(owner, "post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Brass Mug", variants: [{ options: [], priceMinor: 120000, stock: 10, weightGrams: 2500 }] });
  ids.mug = mug.body.product.variants[0].id;
  ids.mugProduct = mug.body.product.id;
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy()]);
});

describe("offers", () => {
  it("creates codes, refuses duplicates and is for offer managers only", async () => {
    const body = { method: "code", code: "kahwa10", title: "10% off kahwa", type: "percentage", value: 1000, minSubtotalMinor: 50000, appliesTo: "products", targetIds: [ids.teaProduct] };
    expect((await as(staff, "post", `${admin()}/discounts`).send(body)).status).toBe(403);
    const created = await as(owner, "post", `${admin()}/discounts`).send(body);
    expect(created.status).toBe(201);
    expect(created.body.discount).toMatchObject({ code: "KAHWA10", status: "active", usageCount: 0 });
    ids.kahwa10 = created.body.discount.id;
    expect((await as(owner, "post", `${admin()}/discounts`).send({ ...body, title: "Again" })).body.errors[0]).toMatchObject({ field: "code", message: "Another offer already uses this code" });
    expect((await as(owner, "post", `${admin()}/discounts`).send({ ...body, code: "X1", value: 0 })).status).toBe(422);
  });

  it("quotes a code, explains why one doesn't apply, and applies it to the right products", async () => {
    const small = await quote({ items: tins(1), discountCode: "kahwa10" });
    expect(small.body.pricing).toMatchObject({ discountMinor: 0, discountError: "Spend ₹500 or more to use this code" });
    const bad = await quote({ items: tins(2), discountCode: "NOPE" });
    expect(bad.body.pricing.discountError).toBe("That code isn't valid");
    const ok = await quote({ items: [...tins(2), { variantId: ids.mug, quantity: 1 }], discountCode: "kahwa10" });
    expect(ok.body.pricing).toMatchObject({ subtotalMinor: 200000, discountMinor: 8000, discount: { code: "KAHWA10", amountMinor: 8000 }, discountError: null });
  });

  it("counts uses at placement, honours limits and once-per-customer, and gives a use back on cancel", async () => {
    await as(owner, "put", `${admin()}/discounts/${ids.kahwa10}`).send({ method: "code", code: "KAHWA10", title: "10% off kahwa", type: "percentage", value: 1000, minSubtotalMinor: 50000, appliesTo: "products", targetIds: [ids.teaProduct], usageLimit: 1, oncePerCustomer: true });
    const first = await place({ ...buyer(), items: tins(2), discountCode: "kahwa10" });
    expect(first.status).toBe(201);
    const id = await orderIdOf(first.body.order.number);
    const detail = await as(owner, "get", `${admin()}/orders/${id}`);
    expect(detail.body.order).toMatchObject({ discountMinor: 8000, discountCode: "KAHWA10", totalMinor: 80000 - 8000 + 5000 });
    expect(detail.body.items[0].discountMinor).toBe(8000);

    const again = await place({ ...buyer({ email: "other@example.com" }), items: tins(2), discountCode: "KAHWA10" });
    expect(again.body.problems).toEqual([{ code: "discount", message: "That code has been fully used" }]);
    expect((await as(owner, "get", `${admin()}/discounts/${ids.kahwa10}`)).body.discount).toMatchObject({ usageCount: 1, status: "used_up", redeemedMinor: 8000 });

    await as(owner, "post", `${admin()}/orders/${id}/cancel`).send({ restock: true });
    expect((await as(owner, "get", `${admin()}/discounts/${ids.kahwa10}`)).body.discount.usageCount).toBe(0);
    await as(owner, "put", `${admin()}/discounts/${ids.kahwa10}`).send({ method: "code", code: "KAHWA10", title: "10% off kahwa", type: "percentage", value: 1000, appliesTo: "all", oncePerCustomer: true });
    const used = await place({ ...buyer(), items: tins(2), discountCode: "KAHWA10" });
    expect(used.status).toBe(201);
    expect((await place({ ...buyer(), items: tins(2), discountCode: "KAHWA10" })).body.problems).toEqual([{ code: "discount", message: "You've already used this code" }]);
  });

  it("applies the best automatic offer without a code", async () => {
    await as(owner, "post", `${admin()}/discounts`).send({ method: "automatic", title: "Free shipping over ₹1,000", type: "free_shipping", value: 0, minSubtotalMinor: 100000 });
    await as(owner, "post", `${admin()}/discounts`).send({ method: "automatic", title: "₹20 off", type: "fixed", value: 2000 });
    const big = await quote({ items: tins(3) });
    expect(big.body.pricing).toMatchObject({ discount: { title: "Free shipping over ₹1,000", amountMinor: 5000 }, deliveryMinor: 0, totalMinor: 120000 });
    const small = await quote({ items: tins(1) });
    expect(small.body.pricing).toMatchObject({ discount: { title: "₹20 off" }, totalMinor: 40000 - 2000 + 5000 });
    expect((await as(owner, "get", `${admin()}/discounts`)).body.items).toHaveLength(3);
    for (const d of (await as(owner, "get", `${admin()}/discounts`)).body.items) await as(owner, "delete", `${admin()}/discounts/${d.id}`).expect(200);
  });

  it("runs buy X get Y deals, on the same products or others, and records the saving on the right line", async () => {
    const deal = { method: "code", code: "MUGDEAL", title: "Buy 2 kahwa, mug half price", type: "buy_x_get_y", value: 5000, appliesTo: "products", targetIds: [ids.teaProduct] };
    expect((await as(owner, "post", `${admin()}/discounts`).send(deal)).body.errors[0]).toMatchObject({ field: "buyXGetY", message: "Say what shoppers buy and what they get" });
    const missing = await as(owner, "post", `${admin()}/discounts`).send({ ...deal, buyXGetY: { buyQuantity: 2, getQuantity: 1, getAppliesTo: "products", getTargetIds: [randomUUID()] } });
    expect(missing.body.errors[0]).toMatchObject({ field: "buyXGetY.getTargetIds" });
    const created = await as(owner, "post", `${admin()}/discounts`).send({ ...deal, buyXGetY: { buyQuantity: 2, getQuantity: 1, getAppliesTo: "products", getTargetIds: [ids.mugProduct], maxApplications: 1 } });
    expect(created.status).toBe(201);
    expect(created.body.discount.buyXGetY).toEqual({ buyQuantity: 2, getQuantity: 1, getAppliesTo: "products", getTargetIds: [ids.mugProduct], maxApplications: 1 });

    const mugs = (quantity: number) => ({ variantId: ids.mug!, quantity });
    expect((await quote({ items: [...tins(1), mugs(1)], discountCode: "mugdeal" })).body.pricing.discountError).toBe("Add 2 qualifying items and 1 more to your cart to use this code");
    // Once per order, however many sets are in the cart.
    const ok = await quote({ items: [...tins(4), mugs(2)], discountCode: "mugdeal" });
    expect(ok.body.pricing).toMatchObject({ discountMinor: 60000, discount: { code: "MUGDEAL", type: "buy_x_get_y", amountMinor: 60000 }, discountError: null });

    const placed = await place({ ...buyer({ email: "deal@example.com" }), items: [...tins(2), mugs(1)], discountCode: "MUGDEAL" });
    expect(placed.status).toBe(201);
    const detail = await as(owner, "get", `${admin()}/orders/${await orderIdOf(placed.body.order.number)}`);
    expect(detail.body.order).toMatchObject({ discountMinor: 60000, discountCode: "MUGDEAL" });
    expect(Object.fromEntries(detail.body.items.map((i: { title: string; discountMinor: number }) => [i.title, i.discountMinor]))).toEqual({ "Kashmiri Kahwa": 0, "Brass Mug": 60000 });

    // An automatic "buy 2, get 1 free" on the same product makes every third tin free.
    await as(owner, "post", `${admin()}/discounts`).send({ method: "automatic", title: "3 for 2 on kahwa", type: "buy_x_get_y", value: 10_000, appliesTo: "products", targetIds: [ids.teaProduct], buyXGetY: { buyQuantity: 2, getQuantity: 1 } });
    expect((await quote({ items: tins(6) })).body.pricing).toMatchObject({ discountMinor: 80000, discount: { title: "3 for 2 on kahwa" } });
    for (const d of (await as(owner, "get", `${admin()}/discounts`)).body.items) await as(owner, "delete", `${admin()}/discounts/${d.id}`).expect(200);
  });
});

describe("shipping zones", () => {
  it("prices delivery by zone, weight and choice, and refuses where the store doesn't deliver", async () => {
    const mumbai = { name: "Mumbai", countries: ["IN"], postalPrefixes: ["400"], codEnabled: false, rates: [{ name: "Same day", kind: "flat", priceMinor: 3000, deliveryTime: "Today" }] };
    const india = {
      name: "Rest of India",
      countries: ["in"],
      rates: [
        { name: "Standard", kind: "flat", priceMinor: 6000, deliveryTime: "4–6 days" },
        { name: "Heavy parcel", kind: "weight", minValue: 2000, priceMinor: 15000 },
      ],
    };
    expect((await as(owner, "post", `${admin()}/shipping/zones`).send({ ...india, rates: [] })).status).toBe(422);
    await as(owner, "post", `${admin()}/shipping/zones`).send(india).expect(201);
    const zones = (await as(owner, "post", `${admin()}/shipping/zones`).send(mumbai).expect(201)).body.zones;
    await as(owner, "put", `${admin()}/shipping/zone-order`).send({ ids: [zones[1].id, zones[0].id] }).expect(200);

    const noAddress = await quote({ items: tins(1), deliveryMethod: "delivery" });
    expect(noAddress.body.pricing.shippingNeedsAddress).toBe(true);
    const blr = await quote({ items: tins(1), deliveryMethod: "delivery", address: { country: "IN", postalCode: "560001" } });
    expect(blr.body.pricing.shippingOptions.map((o: { name: string; priceMinor: number }) => [o.name, o.priceMinor])).toEqual([["Standard", 6000]]);
    const heavy = await quote({ items: [{ variantId: ids.mug, quantity: 1 }], deliveryMethod: "delivery", address: { country: "IN", postalCode: "560001" } });
    const heavyRate = heavy.body.pricing.shippingOptions.find((o: { name: string }) => o.name === "Heavy parcel");
    expect(heavyRate.priceMinor).toBe(15000);

    const placed = await place({ ...buyer({ email: "zone@example.com" }), items: [{ variantId: ids.mug, quantity: 1 }], rateId: heavyRate.id });
    const detail = await as(owner, "get", `${admin()}/orders/${await orderIdOf(placed.body.order.number)}`);
    expect(detail.body.order).toMatchObject({ deliveryMinor: 15000, shippingRateName: "Heavy parcel", totalMinor: 135000 });

    const mum = { ...buyer({ email: "mum@example.com", paymentMethod: "cod" }), address: { line1: "1 Marine Drive", city: "Mumbai", postalCode: "400020" }, items: tins(1) };
    expect((await quote({ items: tins(1), deliveryMethod: "delivery", address: { country: "IN", postalCode: "400020" } })).body.pricing).toMatchObject({ deliveryMinor: 3000, codAllowed: false });
    expect((await place(mum)).body.problems).toEqual([{ code: "payment", message: "Cash on delivery isn't available for this address. Choose another way to pay" }]);
    expect((await place({ ...buyer({ email: "us@example.com" }), address: { line1: "1 Main St", city: "Austin", postalCode: "73301", country: "US" }, items: tins(1) })).body.problems).toEqual([
      { code: "delivery", message: "The shop doesn't deliver to this address yet" },
    ]);
    for (const z of (await as(owner, "get", `${admin()}/shipping/zones`)).body.zones) await as(owner, "delete", `${admin()}/shipping/zones/${z.id}`).expect(200);
  });
});

describe("tax", () => {
  it("shows GST inside tax-inclusive prices, per product rate, and adds VAT when prices exclude it", async () => {
    expect((await as(staff, "put", `${admin()}/tax-settings`).send({ enabled: true, pricesIncludeTax: true, defaultRateBps: 1800, taxShipping: false })).status).toBe(403);
    await as(owner, "put", `${admin()}/tax-settings`).send({ enabled: true, pricesIncludeTax: true, defaultRateBps: 1800, taxShipping: false, label: "GST", registrationNumber: "29abcde1234f1z5" }).expect(200);
    const q = await quote({ items: [...tins(1), { variantId: ids.mug, quantity: 1 }], deliveryMethod: "delivery" });
    // Kahwa at its own 5%, the mug at the 18% default; both already inside the price.
    expect(q.body.pricing).toMatchObject({ taxLabel: "GST", pricesIncludeTax: true, taxMinor: 1905 + 18305, totalMinor: 160000 + 5000 });
    const placed = await place({ ...buyer({ email: "tax@example.com" }), items: tins(1) });
    const id = await orderIdOf(placed.body.order.number);
    const detail = await as(owner, "get", `${admin()}/orders/${id}`);
    expect(detail.body.order).toMatchObject({ taxMinor: 1905, taxLabel: "GST", pricesIncludeTax: true, totalMinor: 45000 });
    expect(detail.body.items[0]).toMatchObject({ taxRateBps: 500, taxMinor: 1905 });
    const pdf = (await as(owner, "get", `${admin()}/orders/${id}/invoice.pdf`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    })).body as Buffer;
    expect(pdf.toString("latin1")).toContain("29ABCDE1234F1Z5");
    expect(pdf.toString("latin1")).toContain("GST included");

    await as(owner, "put", `${admin()}/tax-settings`).send({ enabled: true, pricesIncludeTax: false, defaultRateBps: 2000, taxShipping: true, label: "VAT" }).expect(200);
    const vat = await quote({ items: [{ variantId: ids.mug, quantity: 1 }], deliveryMethod: "delivery" });
    expect(vat.body.pricing).toMatchObject({ taxMinor: 24000 + 1000, totalMinor: 120000 + 5000 + 25000 });
    await as(owner, "put", `${admin()}/tax-settings`).send({ enabled: false, pricesIncludeTax: true, defaultRateBps: 0, taxShipping: false }).expect(200);
  });
});

describe("bookings", () => {
  it("offers real slots with places left, and fills them", async () => {
    const hours = { mon: [["10:00", "12:00"]], tue: [["10:00", "12:00"]], wed: [["10:00", "12:00"]], thu: [["10:00", "12:00"]], fri: [["10:00", "12:00"]], sat: [["10:00", "12:00"]], sun: [["10:00", "12:00"]] };
    expect((await as(owner, "post", `${admin()}/products`).send({ type: "service", status: "active", title: "Bad", bookingDurationMinutes: 60, bookingHours: { ...hours, mon: [["12:00", "10:00"]] }, variants: [{ options: [], priceMinor: 100, trackInventory: false, stock: null }] })).status).toBe(422);
    const created = await as(owner, "post", `${admin()}/products`).send({
      type: "service",
      status: "active",
      title: "Tea Tasting",
      bookingDurationMinutes: 60,
      bookingNoticeHours: 1,
      bookingCapacity: 2,
      bookingHours: hours,
      variants: [{ options: [], priceMinor: 150000, trackInventory: false, stock: null }],
    });
    expect(created.status).toBe(201);
    const variantId = created.body.product.variants[0].id;
    const days = (await request(app).get(`${shop()}/products/tea-tasting/slots`)).body;
    expect(days).toMatchObject({ timeZone: "Asia/Kolkata", durationMinutes: 60 });
    const date = days.days[1] as string;
    const day = (await request(app).get(`${shop()}/products/tea-tasting/slots?date=${date}`)).body;
    expect(day.slots.map((s: { time: string; left: number }) => [s.time, s.left])).toEqual([
      ["10:00", 2],
      ["11:00", 2],
    ]);
    const at = day.slots[0].at as string;
    const booking = (email: string, quantity: number) => place({ ...buyer({ email, deliveryMethod: "none", address: null }), items: [{ variantId, quantity, bookingAt: at }] });
    expect((await booking("b1@example.com", 1)).status).toBe(201);
    expect((await request(app).get(`${shop()}/products/tea-tasting/slots?date=${date}`)).body.slots[0].left).toBe(1);
    expect((await booking("b2@example.com", 2)).body.problems).toEqual([{ item: 0, code: "booking_full", message: "Only 1 place left at that time", available: 1 }]);
    expect((await booking("b2@example.com", 1)).status).toBe(201);
    const list = await as(staff, "get", `${admin()}/bookings`);
    expect(list.body.items.filter((b: { at: string }) => b.at === at).map((b: { customer: string }) => b.customer)).toEqual(["Isha Patel", "Isha Patel"]);
    expect((await request(app).get(`${shop()}/products/kashmiri-kahwa/slots`)).status).toBe(404);
  });
});

describe("digital downloads", () => {
  it("unlocks files once paid, counts downloads, and stops them when cancelled", async () => {
    const media = await withStore(db, storeId, (trx) =>
      trx
        .insertInto("media_assets")
        .values({ store_id: storeId, kind: "file", visibility: "private", status: "ready", filename: "masala-recipes.pdf", declared_type: "application/pdf", content_type: "application/pdf", byte_size: 1024, storage_key: `test/${randomUUID()}.pdf`, created_by: ownerId })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    const ebook = await as(owner, "post", `${admin()}/products`).send({ type: "digital", status: "active", title: "Masala Recipes", downloadLimit: 2, downloadExpiryDays: 7, fileIds: [media.id], variants: [{ options: [], priceMinor: 29900, trackInventory: false, stock: null }] });
    expect(ebook.status).toBe(201);
    const placed = await place({ ...buyer({ email: "reader@example.com", deliveryMethod: "none", address: null }), items: [{ variantId: ebook.body.product.variants[0].id, quantity: 1 }] });
    const token = placed.body.order.token as string;
    expect((await request(app).get(`${shop()}/orders/${token}`)).body.order.downloads).toEqual([]);

    const id = await orderIdOf(placed.body.order.number);
    await as(owner, "post", `${admin()}/orders/${id}/paid`).expect(200);
    const downloads = (await request(app).get(`${shop()}/orders/${token}`)).body.order.downloads;
    expect(downloads).toEqual([expect.objectContaining({ fileName: "masala-recipes.pdf", downloadsLeft: 2, usable: true })]);
    expect(Date.parse(downloads[0].expiresAt)).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const first = await request(app).get(downloads[0].url);
    expect(first.status).toBe(302);
    expect(first.headers.location).toContain("masala-recipes.pdf");
    await request(app).get(downloads[0].url).expect(302);
    expect((await request(app).get(downloads[0].url)).body.code).toBe("DOWNLOAD_LIMIT");
    expect((await request(app).get(`${shop()}/orders/${"x".repeat(32)}/downloads/${downloads[0].id}`)).status).toBe(404);

    await as(owner, "post", `${admin()}/orders/${id}/cancel`).send({ restock: false });
    expect((await request(app).get(`${shop()}/orders/${token}`)).body.order.downloads[0].usable).toBe(false);
    expect((await request(app).get(downloads[0].url)).status).toBe(404);
  });
});
