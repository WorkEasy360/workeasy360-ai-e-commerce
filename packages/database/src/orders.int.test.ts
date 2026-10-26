import { randomUUID } from "node:crypto";
import { DEFAULT_HOURS, slotsOn } from "@workeasy/commerce";
import { createStoreFixture, type StoreFixture } from "@workeasy/test-fixtures";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { withStore } from "./context.js";
import * as checkoutRepo from "./repositories/checkout.js";
import * as inventoryRepo from "./repositories/inventory.js";
import * as mediaRepo from "./repositories/media.js";
import * as ordersRepo from "./repositories/orders.js";
import * as productsRepo from "./repositories/products.js";
import type { ProductInput } from "./repositories/products.js";
import * as storefrontRepo from "./repositories/storefront.js";
import { seedStoreFixture } from "./testing/index.js";

const urls = inject("testDatabase");

/** The first open slot (default hours, store in Asia/Kolkata) at least `noticeHours` ahead. */
function nextSlot(durationMinutes: number, noticeHours: number): Date {
  const now = new Date();
  for (let day = 0; day < 14; day++) {
    const date = new Date(now.getTime() + day * 86_400_000).toISOString().slice(0, 10);
    const slots = slotsOn(date, { hours: DEFAULT_HOURS, durationMinutes, noticeHours, timeZone: "Asia/Kolkata" }, now);
    if (slots.length > 0) return slots[0]!;
  }
  throw new Error("no slot in two weeks");
}

let api: Db;
let publicDb: Db;
let store: StoreFixture;
const owner = () => store.members.find((m) => m.role === "owner")!.user.id;
const inStore = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(api, store.id, fn);

function product(overrides: Partial<ProductInput>): ProductInput {
  return {
    type: "physical",
    status: "active",
    title: "Thing",
    handle: `thing-${randomUUID().slice(0, 8)}`,
    description: "",
    vendor: null,
    tags: [],
    seoTitle: null,
    seoDescription: null,
    downloadLimit: null,
    downloadExpiryDays: null,
    bookingDurationMinutes: null,
    bookingNoticeHours: null,
    bookingCapacity: null,
    options: [],
    variants: [{ options: [], sku: null, barcode: null, priceMinor: 10000, compareAtMinor: null, costMinor: null, weightGrams: null, trackInventory: true, allowBackorder: false, stock: 5 }],
    mediaIds: [],
    fileIds: [],
    collectionIds: [],
    bookingHours: null,
    taxRateBps: null,
    ...overrides,
  };
}

async function create(overrides: Partial<ProductInput>) {
  const id = await inStore((trx) => productsRepo.createProduct(trx, store.id, product(overrides), owner()));
  return (await inStore((trx) => productsRepo.getProduct(trx, id)))!;
}

const order = (items: ordersRepo.PlaceOrderInput["items"], extra: Partial<ordersRepo.PlaceOrderInput> = {}) =>
  inStore((trx) =>
    ordersRepo.placeOrder(trx, {
      storeId: store.id,
      items,
      email: "ravi@example.com",
      name: "Ravi",
      phone: null,
      deliveryMethod: "delivery",
      address: { line1: "12 MG Road", line2: null, city: "Pune", state: "MH", postalCode: "411001", country: "IN" },
      paymentMethod: "cod",
      note: null,
      ...extra,
    }),
  );

beforeAll(async () => {
  api = createDb({ connectionString: urls.api, maxConnections: 6 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  store = createStoreFixture("Orders");
  await seedStoreFixture(api, store);
});

afterAll(async () => {
  await api?.destroy();
  await publicDb?.destroy();
});

describe("storefront reads as the public role", () => {
  it("sees only active products, their variants and public media", async () => {
    const image = await inStore((trx) =>
      mediaRepo.createUpload(trx, { storeId: store.id, kind: "image", visibility: "public", filename: "a.png", declaredType: "image/png", byteSize: 1, storageKey: `${store.id}/${randomUUID()}`, folder: "", createdBy: owner() }),
    );
    const file = await inStore((trx) =>
      mediaRepo.createUpload(trx, { storeId: store.id, kind: "file", visibility: "private", filename: "a.pdf", declaredType: "application/pdf", byteSize: 1, storageKey: `${store.id}/${randomUUID()}`, folder: "", createdBy: owner() }),
    );
    // The superuser stands in for the worker's scan here.
    const operator = createDb({ connectionString: urls.admin, maxConnections: 1 });
    try {
      for (const m of [image, file]) await sql`UPDATE app.media_assets SET status = 'ready' WHERE id = ${m.id}`.execute(operator);
    } finally {
      await operator.destroy();
    }
    const live = await create({ title: "Live", mediaIds: [image.id] });
    const draft = await create({ title: "Hidden draft", status: "draft" });

    const visible = await withStore(publicDb, store.id, async (trx) => ({
      products: (await trx.selectFrom("products").select("id").execute()).map((r) => r.id),
      variants: (await trx.selectFrom("variants").select("product_id").execute()).map((r) => r.product_id),
      media: (await trx.selectFrom("media_assets").select("id").execute()).map((r) => r.id),
    }));
    expect(visible.products).toContain(live.id);
    expect(visible.products).not.toContain(draft.id);
    expect(visible.variants).not.toContain(draft.id);
    expect(visible.media).toEqual([image.id]);

    const shop = await withStore(publicDb, store.id, (trx) => storefrontRepo.productByHandle(trx, live.handle));
    expect(shop).toMatchObject({ title: "Live", media: [{ id: image.id }], variants: [{ priceMinor: 10000, available: true, maxQuantity: 5 }] });
    expect(await withStore(publicDb, store.id, (trx) => storefrontRepo.productByHandle(trx, draft.handle))).toBeUndefined();
  });

  it("cannot write anything", async () => {
    const err = await withStore(publicDb, store.id, (trx) => trx.updateTable("products").set({ title: "x" }).execute()).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("42501");
    const err2 = await withStore(publicDb, store.id, (trx) => trx.selectFrom("orders").selectAll().execute()).catch((e: unknown) => e);
    expect((err2 as { code?: string }).code).toBe("42501");
  });
});

describe("placing orders", () => {
  it("prices from the catalog, numbers orders, takes stock and records the sale", async () => {
    const p = await create({ title: "Tea", variants: [{ ...product({}).variants[0]!, priceMinor: 34900, stock: 5 }] });
    await inStore((trx) => checkoutRepo.saveCheckoutSettings(trx, store.id, { ...checkoutRepo.DEFAULT_CHECKOUT_SETTINGS, deliveryFeeMinor: 5000, freeDeliveryOverMinor: 100000 }));
    const placed = await order([{ variantId: p.variants[0]!.id, quantity: 2 }]);
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    expect(placed.number).toBeGreaterThan(1000);
    const full = (await inStore((trx) => ordersRepo.getOrder(trx, placed.orderId)))!;
    expect(full.order).toMatchObject({ subtotalMinor: 69800, deliveryMinor: 5000, totalMinor: 74800, paymentStatus: "pending", status: "open" });
    expect(full.items).toEqual([expect.objectContaining({ title: "Tea", quantity: 2, unitPriceMinor: 34900, totalMinor: 69800 })]);
    expect(full.events.map((e) => e.kind)).toEqual(["placed"]);
    expect((await inStore((trx) => inventoryRepo.getLevel(trx, p.variants[0]!.id)))!.onHand).toBe(3);
    const viaToken = await inStore((trx) => ordersRepo.orderByToken(trx, placed.token));
    expect(viaToken?.order.id).toBe(placed.orderId);

    const next = await order([{ variantId: p.variants[0]!.id, quantity: 1 }]);
    expect(next.kind === "placed" && next.number).toBe(placed.number + 1);
  });

  it("never sells the last unit twice, even at the same moment", async () => {
    const p = await create({ title: "Last one", variants: [{ ...product({}).variants[0]!, stock: 1 }] });
    const results = await Promise.all([order([{ variantId: p.variants[0]!.id, quantity: 1 }]), order([{ variantId: p.variants[0]!.id, quantity: 1 }])]);
    expect(results.map((r) => r.kind).toSorted()).toEqual(["placed", "problems"]);
    const failed = results.find((r) => r.kind === "problems");
    expect(failed).toMatchObject({ problems: [{ item: 0, code: "insufficient_stock", message: "Out of stock", available: 0 }] });
    expect((await inStore((trx) => inventoryRepo.getLevel(trx, p.variants[0]!.id)))!.onHand).toBe(0);
  });

  it("explains every problem: drafts, booking notice, delivery and payment methods", async () => {
    const draft = await create({ status: "draft" });
    const service = await create({ type: "service", title: "Session", bookingDurationMinutes: 60, bookingNoticeHours: 24, variants: [{ ...product({}).variants[0]!, trackInventory: false, stock: null }] });
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const r = await order([{ variantId: draft.variants[0]!.id, quantity: 1 }, { variantId: service.variants[0]!.id, quantity: 1, bookingAt: soon }], { paymentMethod: "bank", deliveryMethod: "pickup" });
    expect(r).toEqual({
      kind: "problems",
      problems: [
        { code: "payment", message: "That payment method isn't available. Choose another" },
        { item: 0, code: "unavailable", message: "This item is no longer available" },
        { item: 1, code: "booking_time", message: "Book at least 24 hours ahead" },
        { code: "delivery", message: "Choose how you'd like to receive your order" },
      ],
    });
    // A time that isn't one of the service's slots is refused.
    const slot = nextSlot(60, 24);
    const offSlot = new Date(slot.getTime() + 15 * 60_000).toISOString();
    expect(await order([{ variantId: service.variants[0]!.id, quantity: 1, bookingAt: offSlot }], { deliveryMethod: "none", address: null })).toEqual({
      kind: "problems",
      problems: [{ item: 0, code: "booking_time", message: "That time isn't available. Choose another slot" }],
    });
    // A service alone needs no delivery.
    const ok = await order([{ variantId: service.variants[0]!.id, quantity: 1, bookingAt: slot.toISOString() }], { deliveryMethod: "none", address: null });
    expect(ok.kind).toBe("placed");
    // One place per slot by default: the next shopper is told it's taken.
    expect(await order([{ variantId: service.variants[0]!.id, quantity: 1, bookingAt: slot.toISOString() }], { deliveryMethod: "none", address: null })).toEqual({
      kind: "problems",
      problems: [{ item: 0, code: "booking_full", message: "That time is fully booked. Choose another slot", available: 0 }],
    });
  });
});

describe("merchant actions", () => {
  it("marks paid and fulfilled, and cancels with restock exactly once", async () => {
    const p = await create({ title: "Mug", variants: [{ ...product({}).variants[0]!, stock: 4 }] });
    const placed = await order([{ variantId: p.variants[0]!.id, quantity: 3 }]);
    if (placed.kind !== "placed") throw new Error("not placed");
    expect(await inStore((trx) => ordersRepo.markPaid(trx, store.id, placed.orderId, owner()))).toBe("done");
    expect(await inStore((trx) => ordersRepo.markPaid(trx, store.id, placed.orderId, owner()))).toBe("not_allowed");
    expect(await inStore((trx) => ordersRepo.cancelOrder(trx, store.id, placed.orderId, owner(), true))).toBe("done");
    expect(await inStore((trx) => ordersRepo.cancelOrder(trx, store.id, placed.orderId, owner(), true))).toBe("not_allowed");
    expect((await inStore((trx) => inventoryRepo.getLevel(trx, p.variants[0]!.id)))!.onHand).toBe(4);
    const history = await inStore((trx) => inventoryRepo.listMovements(trx, p.variants[0]!.id));
    expect(history.map((m) => [m.reason, m.delta])).toEqual([["cancelled", 3], ["sold", -3], ["initial", 4]]);
    const full = (await inStore((trx) => ordersRepo.getOrder(trx, placed.orderId)))!;
    expect(full.events.map((e) => e.kind)).toEqual(["placed", "paid", "cancelled"]);
    expect(await inStore((trx) => ordersRepo.markFulfilled(trx, store.id, placed.orderId, owner()))).toBe("not_allowed");
  });

  it("summarises sales for the dashboard", async () => {
    const summary = await inStore((trx) => ordersRepo.salesSummary(trx, new Date(Date.now() - 86_400_000), "Asia/Kolkata"));
    expect(summary.orders).toBeGreaterThan(0);
    expect(summary.daily.length).toBeGreaterThan(0);
  });
});
