import { randomUUID } from "node:crypto";
import { createStoreFixture, type StoreFixture } from "@workeasy/test-fixtures";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { withStore } from "./context.js";
import * as collectionsRepo from "./repositories/collections.js";
import * as inventoryRepo from "./repositories/inventory.js";
import * as mediaRepo from "./repositories/media.js";
import * as productsRepo from "./repositories/products.js";
import type { ProductInput, VariantInput } from "./repositories/products.js";
import { seedStoreFixture } from "./testing/index.js";

const urls = inject("testDatabase");

let api: Db;
let worker: Db;
let a: StoreFixture;
let b: StoreFixture;
const ownerOf = (s: StoreFixture) => s.members.find((m) => m.role === "owner")!.user.id;

beforeAll(async () => {
  api = createDb({ connectionString: urls.api, maxConnections: 4 });
  worker = createDb({ connectionString: urls.worker, maxConnections: 2 });
  a = createStoreFixture("Catalog A");
  b = createStoreFixture("Catalog B");
  await seedStoreFixture(api, a);
  await seedStoreFixture(api, b);
});

afterAll(async () => {
  await api?.destroy();
  await worker?.destroy();
});

function variant(options: string[], overrides: Partial<VariantInput> = {}): VariantInput {
  return {
    options,
    sku: null,
    barcode: null,
    priceMinor: 49900,
    compareAtMinor: null,
    costMinor: null,
    weightGrams: null,
    trackInventory: true,
    allowBackorder: false,
    stock: null,
    ...overrides,
  };
}

function product(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    type: "physical",
    status: "draft",
    title: "Cotton Tee",
    handle: `tee-${randomUUID().slice(0, 8)}`,
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
    variants: [variant([])],
    mediaIds: [],
    fileIds: [],
    collectionIds: [],
    bookingHours: null,
    taxRateBps: null,
    ...overrides,
  };
}

const inA = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(api, a.id, fn);

describe("products", () => {
  it("creates a product with options, variants and opening stock recorded in the ledger", async () => {
    const id = await inA((trx) =>
      productsRepo.createProduct(
        trx,
        a.id,
        product({
          status: "active",
          options: [{ name: "Size", values: ["S", "M"] }],
          variants: [variant(["S"], { sku: `S-${randomUUID().slice(0, 6)}`, stock: 10 }), variant(["M"], { priceMinor: 59900, stock: 0 })],
        }),
        ownerOf(a),
      ),
    );
    const p = await inA((trx) => productsRepo.getProduct(trx, id));
    expect(p).toMatchObject({ status: "active", options: [{ name: "Size", values: ["S", "M"] }] });
    expect(p!.publishedAt).toBeInstanceOf(Date);
    expect(p!.variants.map((v) => [v.options, v.priceMinor, v.onHand])).toEqual([
      [["S"], 49900, 10],
      [["M"], 59900, 0],
    ]);
    const movements = await inA((trx) => inventoryRepo.listMovements(trx, p!.variants[0]!.id));
    expect(movements.map((m) => [m.reason, m.delta, m.onHandAfter])).toEqual([["initial", 10, 10]]);
  });

  it("keeps variant ids and stock across an edit, records stock changes, and lets variants swap SKUs", async () => {
    const skuS = `S-${randomUUID().slice(0, 6)}`;
    const skuM = `M-${randomUUID().slice(0, 6)}`;
    const id = await inA((trx) =>
      productsRepo.createProduct(
        trx,
        a.id,
        product({ options: [{ name: "Size", values: ["S", "M"] }], variants: [variant(["S"], { sku: skuS, stock: 5 }), variant(["M"], { sku: skuM, stock: 2 })] }),
        ownerOf(a),
      ),
    );
    const before = (await inA((trx) => productsRepo.getProduct(trx, id)))!;
    const [s, m] = before.variants;
    await inA((trx) =>
      productsRepo.updateProduct(
        trx,
        a.id,
        id,
        product({
          handle: before.handle,
          options: [{ name: "Size", values: ["M", "S", "L"] }],
          variants: [
            variant(["M"], { id: m!.id, sku: skuS, stock: null }),
            variant(["S"], { id: s!.id, sku: skuM, stock: 8 }),
            variant(["L"], { stock: 1 }),
          ],
        }),
        ownerOf(a),
      ),
    );
    const after = (await inA((trx) => productsRepo.getProduct(trx, id)))!;
    expect(after.variants.map((v) => [v.id === m!.id ? "m" : v.id === s!.id ? "s" : "new", v.options, v.sku, v.onHand])).toEqual([
      ["m", ["M"], skuS, 2],
      ["s", ["S"], skuM, 8],
      ["new", ["L"], null, 1],
    ]);
    const ledger = await inA((trx) => inventoryRepo.listMovements(trx, s!.id));
    expect(ledger.map((x) => [x.reason, x.delta, x.onHandAfter])).toEqual([
      ["correction", 3, 8],
      ["initial", 5, 5],
    ]);
  });

  it("refuses a duplicate handle or SKU within a store, but not across stores", async () => {
    const handle = `dup-${randomUUID().slice(0, 8)}`;
    const sku = `DUP-${randomUUID().slice(0, 6)}`;
    await inA((trx) => productsRepo.createProduct(trx, a.id, product({ handle, variants: [variant([], { sku })] }), ownerOf(a)));
    const handleErr = await inA((trx) => productsRepo.createProduct(trx, a.id, product({ handle }), ownerOf(a))).catch((e: unknown) => e);
    expect(productsRepo.conflictOf(handleErr)).toBe("handle");
    const skuErr = await inA((trx) => productsRepo.createProduct(trx, a.id, product({ variants: [variant([], { sku: sku.toLowerCase() })] }), ownerOf(a))).catch((e: unknown) => e);
    expect(productsRepo.conflictOf(skuErr)).toBe("sku");
    await withStore(api, b.id, (trx) => productsRepo.createProduct(trx, b.id, product({ handle, variants: [variant([], { sku })] }), ownerOf(b)));
  });

  it("never links another store's media", async () => {
    const foreign = await withStore(api, b.id, (trx) =>
      mediaRepo.createUpload(trx, { storeId: b.id, kind: "image", visibility: "public", filename: "b.png", declaredType: "image/png", byteSize: 10, storageKey: `${b.id}/${randomUUID()}`, folder: "", createdBy: ownerOf(b) }),
    );
    const err = await inA((trx) => productsRepo.createProduct(trx, a.id, product({ mediaIds: [foreign.id] }), ownerOf(a))).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("23503");
  });

  it("exports and re-imports, updating by handle and keeping stock where cells are blank", async () => {
    const store = createStoreFixture("Import");
    await seedStoreFixture(api, store);
    const owner = ownerOf(store);
    const inStore = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(api, store.id, fn);
    await inStore((trx) =>
      productsRepo.createProduct(trx, store.id, product({ handle: "mug", title: "Mug", options: [{ name: "Colour", values: ["White"] }], variants: [variant(["White"], { stock: 7 })] }), owner),
    );
    const exported = await inStore((trx) => productsRepo.exportProducts(trx));
    expect(exported).toHaveLength(1);
    const edited = { ...exported[0]!, title: "Ceramic Mug", options: [{ name: "Colour", values: ["White", "Black"] }] };
    edited.variants = [{ ...edited.variants[0]!, stock: null, priceMinor: 39900 }, { ...edited.variants[0]!, options: ["Black"], stock: 3 }];
    const result = await inStore((trx) =>
      productsRepo.importProducts(trx, store.id, [edited, { ...edited, handle: "new-mug", title: "New Mug", variants: [{ ...edited.variants[0]!, stock: 4 }], options: [{ name: "Colour", values: ["White"] }] }], owner),
    );
    expect(result).toEqual({ created: 1, updated: 1 });
    const again = await inStore((trx) => productsRepo.exportProducts(trx));
    expect(again.map((p) => [p.handle, p.title, p.variants.map((v) => [v.options, v.priceMinor, v.stock])])).toEqual([
      ["mug", "Ceramic Mug", [[["White"], 39900, 7], [["Black"], 49900, 3]]],
      ["new-mug", "New Mug", [[["White"], 39900, 4]]],
    ]);
  });

  it("lists with search, status filters and stock totals", async () => {
    const tag = `t${randomUUID().slice(0, 6)}`;
    const id = await inA((trx) =>
      productsRepo.createProduct(trx, a.id, product({ title: `Searchable ${tag}`, tags: [tag], variants: [variant([], { stock: 4, priceMinor: 100 })] }), ownerOf(a)),
    );
    const byTag = await inA((trx) => productsRepo.listProducts(trx, { q: tag, limit: 10 }));
    expect(byTag.items.map((p) => [p.id, p.stock, p.priceMin])).toEqual([[id, 4, 100]]);
    await inA((trx) => productsRepo.setStatus(trx, [id], "archived"));
    expect((await inA((trx) => productsRepo.listProducts(trx, { q: tag, limit: 10 }))).items).toEqual([]);
    expect((await inA((trx) => productsRepo.listProducts(trx, { q: tag, status: "archived", limit: 10 }))).items).toHaveLength(1);
  });
});

describe("collections", () => {
  it("matches automated rules and keeps manual order", async () => {
    const store = createStoreFixture("Collections");
    await seedStoreFixture(api, store);
    const owner = ownerOf(store);
    const inStore = <T>(fn: Parameters<typeof withStore<T>>[2]) => withStore(api, store.id, fn);
    const cheap = await inStore((trx) => productsRepo.createProduct(trx, store.id, product({ title: "Cheap Summer Hat", tags: ["summer"], variants: [variant([], { priceMinor: 20000 })] }), owner));
    const dear = await inStore((trx) => productsRepo.createProduct(trx, store.id, product({ title: "Dear Summer Coat", tags: ["summer"], variants: [variant([], { priceMinor: 900000 })] }), owner));
    await inStore((trx) => productsRepo.createProduct(trx, store.id, product({ title: "Winter Scarf", tags: ["winter"] }), owner));

    const rules = { match: "all" as const, conditions: [{ field: "tag" as const, operator: "equals" as const, value: "Summer" }, { field: "price" as const, operator: "less_than" as const, value: "100000" }] };
    expect(await inStore((trx) => collectionsRepo.previewRules(trx, rules))).toEqual({ ids: [cheap], count: 1 });
    const anyRules = { match: "any" as const, conditions: [{ field: "title" as const, operator: "starts_with" as const, value: "dear" }, { field: "tag" as const, operator: "equals" as const, value: "winter" }] };
    expect((await inStore((trx) => collectionsRepo.previewRules(trx, anyRules))).count).toBe(2);

    const base = { description: "", imageId: null, published: true, seoTitle: null, seoDescription: null };
    const manual = await inStore((trx) =>
      collectionsRepo.createCollection(trx, store.id, { ...base, title: "Picks", handle: "picks", kind: "manual", rules: null, sortOrder: "manual", productIds: [dear, cheap] }),
    );
    expect(await inStore((trx) => collectionsRepo.productIdsIn(trx, manual))).toEqual([dear, cheap]);
    const auto = await inStore((trx) =>
      collectionsRepo.createCollection(trx, store.id, { ...base, title: "Summer", handle: "summer", kind: "automated", rules: { match: "all", conditions: [{ field: "tag", operator: "equals", value: "summer" }] }, sortOrder: "price_desc", productIds: [] }),
    );
    expect(await inStore((trx) => collectionsRepo.productIdsIn(trx, auto))).toEqual([dear, cheap]);
    const listed = await inStore((trx) => collectionsRepo.listCollections(trx));
    expect(listed.map((c) => [c.title, c.productCount])).toEqual([["Picks", 2], ["Summer", 2]]);

    // Joining a manual collection from the product editor appends it at the end.
    const extra = await inStore((trx) => productsRepo.createProduct(trx, store.id, product({ title: "Extra", collectionIds: [manual.id, auto.id] }), owner));
    expect(await inStore((trx) => collectionsRepo.productIdsIn(trx, manual))).toEqual([dear, cheap, extra]);
  });
});

describe("inventory", () => {
  it("adjusts, sets and filters stock with a consistent ledger", async () => {
    const id = await inA((trx) => productsRepo.createProduct(trx, a.id, product({ title: `Stock ${randomUUID().slice(0, 6)}`, variants: [variant([], { stock: 3 })] }), ownerOf(a)));
    const variantId = (await inA((trx) => productsRepo.getProduct(trx, id)))!.variants[0]!.id;
    expect(await inA((trx) => inventoryRepo.recordMovement(trx, { storeId: a.id, variantId, delta: 7, reason: "received", note: "PO-12", actorId: ownerOf(a) }))).toBe(10);
    expect(await inA((trx) => inventoryRepo.setOnHand(trx, { storeId: a.id, variantId, target: 2, reason: "damaged", actorId: ownerOf(a) }))).toBe(2);
    const ledger = await inA((trx) => inventoryRepo.listMovements(trx, variantId));
    expect(ledger.map((m) => [m.reason, m.delta, m.onHandAfter])).toEqual([["damaged", -8, 2], ["received", 7, 10], ["initial", 3, 3]]);
    const low = await inA((trx) => inventoryRepo.listInventory(trx, { filter: "low", limit: 500 }));
    expect(low.rows.some((r) => r.variantId === variantId)).toBe(true);
    await inA((trx) => inventoryRepo.setThreshold(trx, variantId, 1));
    const lowAfter = await inA((trx) => inventoryRepo.listInventory(trx, { filter: "low", limit: 500 }));
    expect(lowAfter.rows.some((r) => r.variantId === variantId)).toBe(false);
  });
});

describe("media scanning", () => {
  it("lets the worker record a scan result only while the asset is scanning", async () => {
    const asset = await inA((trx) =>
      mediaRepo.createUpload(trx, { storeId: a.id, kind: "image", visibility: "public", filename: "a.png", declaredType: "image/png", byteSize: 10, storageKey: `${a.id}/${randomUUID()}`, folder: "", createdBy: ownerOf(a) }),
    );
    expect(await mediaRepo.finishScan(worker, { id: asset.id, storeId: a.id }, { outcome: "ready", contentType: "image/png", width: 1, height: 1 })).toBe(false);
    await inA((trx) => mediaRepo.markScanning(trx, asset.id));
    expect(await mediaRepo.finishScan(worker, { id: asset.id, storeId: a.id }, { outcome: "ready", contentType: "image/png", width: 640, height: 480 })).toBe(true);
    expect(await inA((trx) => mediaRepo.getMedia(trx, asset.id))).toMatchObject({ status: "ready", width: 640, height: 480 });
  });
});
