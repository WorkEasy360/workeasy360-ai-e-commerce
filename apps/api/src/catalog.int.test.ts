import { randomUUID } from "node:crypto";
import { createDb, identityRepo, withStore, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { mediaScanJob } from "@workeasy/files";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testObjectStore, testSettings, unusedIdentityProvider } from "./test-support.js";

/** Products, collections, inventory and media through the HTTP API. Needs `pnpm infra:up` and the scanner. */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let publicDb: Db;
let workerDb: Db;
let app: Express;
let owner: string;
let analyst: string;
let storeId: string;

async function newUser(): Promise<{ id: string; token: string }> {
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `catalog-${randomUUID()}` });
  return { id, token: (await identityRepo.createSession(db, id, 60 * 60 * 1000)).token };
}

const as = (token: string, method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
  request(app)[method](path).set("Cookie", `wec_session=${token}`).set("Origin", TEST_ADMIN_ORIGIN);
const base = () => `/api/v1/stores/${storeId}`;

function productBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "physical",
    status: "active",
    title: "Masala Chai",
    options: [{ name: "Size", values: ["250g", "500g"] }],
    variants: [
      { options: ["250g"], priceMinor: 34900, sku: `CHAI-250-${randomUUID().slice(0, 4)}`, stock: 20 },
      { options: ["500g"], priceMinor: 59900, compareAtMinor: 69900, stock: 5 },
    ],
    tags: ["Tea", "tea", "Bestseller"],
    ...overrides,
  };
}

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 4 });
  publicDb = createDb({ connectionString: urls.public, maxConnections: 2 });
  workerDb = createDb({ connectionString: urls.worker, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, testSettings, publicDb);
  const o = await newUser();
  const a = await newUser();
  owner = o.token;
  analyst = a.token;
  const created = await as(owner, "post", "/api/v1/stores").send({ name: "Chai Co", slug: `chai-${randomUUID().slice(0, 8)}` });
  storeId = created.body.store.id;
  await withStore(db, storeId, (trx) => trx.insertInto("memberships").values({ store_id: storeId, user_id: a.id, role: "analyst" }).execute());
});

afterAll(async () => {
  await Promise.all([db.destroy(), publicDb.destroy(), workerDb.destroy()]);
});

describe("products API", () => {
  it("creates, reads, edits and lists a product", async () => {
    const created = await as(owner, "post", `${base()}/products`).send(productBody());
    expect(created.status).toBe(201);
    const p = created.body.product;
    expect(p).toMatchObject({ title: "Masala Chai", handle: "masala-chai", status: "active", tags: ["tea", "bestseller"] });
    expect(p.variants.map((v: { options: string[]; onHand: number }) => [v.options, v.onHand])).toEqual([[["250g"], 20], [["500g"], 5]]);

    // A second product from the same title gets the next free handle.
    const twin = await as(owner, "post", `${base()}/products`).send(productBody({ variants: [{ options: ["250g"], priceMinor: 100 }, { options: ["500g"], priceMinor: 200 }] }));
    expect(twin.body.product.handle).toBe("masala-chai-2");

    const edited = await as(owner, "put", `${base()}/products/${p.id}`).send(
      productBody({
        title: "Masala Chai Blend",
        handle: p.handle,
        variants: [{ id: p.variants[0].id, options: ["250g"], priceMinor: 32900, sku: p.variants[0].sku, stock: 18 }, { id: p.variants[1].id, options: ["500g"], priceMinor: 59900 }],
      }),
    );
    expect(edited.status).toBe(200);
    expect(edited.body.product.variants.map((v: { id: string; onHand: number; priceMinor: number }) => [v.id, v.priceMinor, v.onHand])).toEqual([
      [p.variants[0].id, 32900, 18],
      [p.variants[1].id, 59900, 5],
    ]);

    const list = await as(analyst, "get", `${base()}/products?q=blend`);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({ id: p.id, priceMin: 32900, priceMax: 59900, stock: 23, variantCount: 2 })]);
    expect(list.body.counts.active).toBeGreaterThanOrEqual(2);
  });

  it("explains invalid products field by field", async () => {
    const res = await as(owner, "post", `${base()}/products`).send(
      productBody({ variants: [{ options: ["250g"], priceMinor: 500, compareAtMinor: 400 }, { options: ["1kg"], priceMinor: 900 }] }),
    );
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string; message: string }) => [e.field, e.message])).toEqual([
      ["variants.0.compareAtMinor", "Compare-at price must be higher than the price"],
      ["variants.1.options.0", '"1kg" is not a value of Size'],
    ]);
    const service = await as(owner, "post", `${base()}/products`).send({ type: "service", title: "Tasting", variants: [{ options: [], priceMinor: 100 }] });
    expect(service.body.errors[0]).toMatchObject({ field: "bookingDurationMinutes" });
  });

  it("reports SKU conflicts and keeps analysts read-only", async () => {
    const sku = `DUP-${randomUUID().slice(0, 6)}`;
    expect((await as(owner, "post", `${base()}/products`).send(productBody({ title: "A", variants: [{ options: ["250g"], priceMinor: 1, sku }, { options: ["500g"], priceMinor: 2 }] }))).status).toBe(201);
    const dup = await as(owner, "post", `${base()}/products`).send(productBody({ title: "B", variants: [{ options: ["250g"], priceMinor: 1, sku }, { options: ["500g"], priceMinor: 2 }] }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("SKU_TAKEN");
    expect((await as(analyst, "post", `${base()}/products`).send(productBody())).status).toBe(403);
  });

  it("archives and deletes in bulk", async () => {
    const ids: string[] = [];
    for (const title of ["Bulk One", "Bulk Two"]) {
      ids.push((await as(owner, "post", `${base()}/products`).send(productBody({ title, variants: [{ options: ["250g"], priceMinor: 1 }, { options: ["500g"], priceMinor: 2 }] }))).body.product.id);
    }
    expect((await as(owner, "post", `${base()}/products/bulk`).send({ ids, action: "archive" })).body).toEqual({ changed: 2 });
    expect((await as(owner, "get", `${base()}/products?q=bulk`)).body.items).toEqual([]);
    expect((await as(owner, "post", `${base()}/products/bulk`).send({ ids: [...ids, randomUUID()], action: "delete" })).body).toEqual({ changed: 2 });
    expect((await as(owner, "get", `${base()}/products/${ids[0]}`)).status).toBe(404);
  });

  it("exports a spreadsheet, previews an import and applies it", async () => {
    const exported = await as(owner, "get", `${base()}/products/export.csv`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/^text\/csv/);
    expect(exported.text.startsWith("﻿Handle,Title,Type")).toBe(true);

    const csv = ["Handle,Title,Price,Stock,Option1 Name,Option1 Value", "chai-mug,Chai Mug,299,12,Colour,White", "chai-mug,,349,,,Black", "bad handle!,X,1,,,"].join("\n");
    const preview = await as(owner, "post", `${base()}/products/import?dryRun=true`).set("Content-Type", "text/csv").send(csv);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ applied: false, create: 1, update: 0, products: [{ handle: "chai-mug", variants: 2, action: "create", removesVariants: 0 }] });
    expect(preview.body.problems).toEqual([{ row: 4, message: '"bad handle!" is not a valid handle: use lowercase letters, numbers and hyphens' }]);
    expect((await as(owner, "get", `${base()}/products?q=chai-mug`)).body.items).toEqual([]);

    const applied = await as(owner, "post", `${base()}/products/import?dryRun=false`).set("Content-Type", "text/csv").send(csv);
    expect(applied.body).toMatchObject({ applied: true, create: 1 });
    const mug = (await as(owner, "get", `${base()}/products?q=chai-mug`)).body.items[0];
    expect(mug).toMatchObject({ title: "Chai Mug", stock: 12, priceMin: 29900, priceMax: 34900, status: "draft" });

    // Re-importing with one variant warns that the other goes.
    const shrink = await as(owner, "post", `${base()}/products/import`).set("Content-Type", "text/csv").send("Handle,Title,Price,Option1 Name,Option1 Value\nchai-mug,Chai Mug,299,Colour,White\n");
    expect(shrink.body.products).toEqual([expect.objectContaining({ handle: "chai-mug", action: "update", removesVariants: 1 })]);
  });
});

describe("collections API", () => {
  it("previews rules and keeps manual collections in order", async () => {
    const preview = await as(owner, "post", `${base()}/collections/preview`).send({ rules: { match: "all", conditions: [{ field: "tag", operator: "equals", value: "bestseller" }] } });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBeGreaterThanOrEqual(1);

    const auto = await as(owner, "post", `${base()}/collections`).send({
      title: "Bestsellers",
      kind: "automated",
      sortOrder: "price_asc",
      rules: { match: "all", conditions: [{ field: "tag", operator: "equals", value: "bestseller" }] },
    });
    expect(auto.status).toBe(201);
    expect(auto.body.collection.handle).toBe("bestsellers");
    const detail = await as(analyst, "get", `${base()}/collections/${auto.body.collection.id}`);
    expect(detail.body.productCount).toBe(preview.body.count);

    const bad = await as(owner, "post", `${base()}/collections`).send({ title: "Bad", kind: "automated", sortOrder: "manual", rules: { match: "all", conditions: [] } });
    expect(bad.status).toBe(422);

    const ids = preview.body.products.map((p: { id: string }) => p.id).toReversed();
    const manual = await as(owner, "post", `${base()}/collections`).send({ title: "Staff picks", kind: "manual", productIds: ids });
    const manualDetail = await as(owner, "get", `${base()}/collections/${manual.body.collection.id}`);
    expect(manualDetail.body.products.map((p: { id: string }) => p.id)).toEqual(ids);
    expect((await as(owner, "get", `${base()}/collections?kind=manual`)).body.items).toEqual([{ id: manual.body.collection.id, title: "Staff picks" }]);
  });
});

describe("inventory API", () => {
  it("adds, sets and lists stock with its history", async () => {
    const p = (await as(owner, "post", `${base()}/products`).send(productBody({ title: "Stock Tin", variants: [{ options: ["250g"], priceMinor: 1, stock: 4 }, { options: ["500g"], priceMinor: 2, stock: 0 }] }))).body.product;
    const variantId = p.variants[0].id;
    const added = await as(owner, "post", `${base()}/inventory/${variantId}/adjust`).send({ mode: "add", quantity: 6, reason: "received", note: "Supplier delivery" });
    expect(added.body).toMatchObject({ onHand: 10, available: 10 });
    const set = await as(owner, "post", `${base()}/inventory/${variantId}/adjust`).send({ mode: "set", quantity: 3, reason: "damaged" });
    expect(set.body.onHand).toBe(3);
    expect((await as(analyst, "post", `${base()}/inventory/${variantId}/adjust`).send({ mode: "add", quantity: 1, reason: "received" })).status).toBe(403);

    const history = await as(analyst, "get", `${base()}/inventory/${variantId}/movements`);
    expect(history.body.movements.map((m: { reason: string; delta: number; note: string | null }) => [m.reason, m.delta, m.note])).toEqual([
      ["damaged", -7, null],
      ["received", 6, "Supplier delivery"],
      ["initial", 4, null],
    ]);
    const out = await as(owner, "get", `${base()}/inventory?filter=out&q=stock tin`);
    expect(out.body.items.map((r: { variantId: string }) => r.variantId)).toEqual([p.variants[1].id]);
    expect(out.body.summary.out).toBeGreaterThanOrEqual(1);
  });
});

describe("media API", () => {
  const store = testObjectStore();
  const scan = () => mediaScanJob({ workerDb, store, scanner: { host: process.env.SCANNER_HOST ?? "127.0.0.1", port: Number(process.env.SCANNER_PORT ?? 3310) } });

  function tinyPng(): Buffer {
    // A real 1×1 PNG.
    return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  }

  async function upload(file: Buffer, filename: string, contentType: string, purpose: "media" | "file" = "media") {
    const created = await as(owner, "post", `${base()}/media/uploads`).send({ filename, contentType, byteSize: file.length, purpose });
    expect(created.status).toBe(201);
    const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: file });
    expect(put.ok).toBe(true);
    const completed = await as(owner, "post", `${base()}/media/${created.body.media.id}/complete`);
    expect(completed.body.media.status).toBe("scanning");
    const id: string = created.body.media.id;
    await scan().handle({ id: randomUUID(), storeId, type: "media.scan", payload: { mediaId: id }, dedupeKey: id, attempt: 1, maxAttempts: 10, traceId: null, signal: new AbortController().signal });
    return (await as(owner, "get", `${base()}/media/${id}`)).body.media;
  }

  it("uploads, scans and serves a public image, and uses it on a product", async () => {
    const media = await upload(tinyPng(), "../tea leaves.png", "image/png");
    expect(media).toMatchObject({ status: "ready", kind: "image", visibility: "public", contentType: "image/png", width: 1, height: 1, filename: "tea leaves.png" });

    const shown = await request(app).get(`/public/v1/media/${media.id}`);
    expect(shown.status).toBe(302);
    const image = await fetch(shown.headers.location!);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(tinyPng());

    const product = await as(owner, "post", `${base()}/products`).send(productBody({ title: "Pictured Tea", mediaIds: [media.id], variants: [{ options: ["250g"], priceMinor: 1 }, { options: ["500g"], priceMinor: 2 }] }));
    expect(product.body.product.mediaIds).toEqual([media.id]);
    expect((await as(owner, "get", `${base()}/media/${media.id}`)).body.usage.products).toEqual([{ id: product.body.product.id, title: "Pictured Tea", as: "media" }]);
  });

  it("keeps digital files private and refuses deleting one a product delivers", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% brew guide\n");
    const file = await upload(pdf, "brew-guide.pdf", "application/pdf", "file");
    expect(file).toMatchObject({ status: "ready", kind: "file", visibility: "private" });
    expect((await request(app).get(`/public/v1/media/${file.id}`)).status).toBe(404);
    const link = await as(owner, "get", `${base()}/media/${file.id}/download`);
    expect(Buffer.from(await (await fetch(link.body.url)).arrayBuffer())).toEqual(pdf);

    const ebook = await as(owner, "post", `${base()}/products`).send({ type: "digital", title: "Brew Guide", fileIds: [file.id], downloadLimit: 3, variants: [{ options: [], priceMinor: 19900, trackInventory: false }] });
    expect(ebook.status).toBe(201);
    const del = await as(owner, "delete", `${base()}/media/${file.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("MEDIA_IN_USE");
  });

  it("rejects content that isn't what it claims, and malware", async () => {
    const fake = await upload(Buffer.from("MZ\x90\x00 not really a png", "latin1"), "fake.png", "image/png");
    expect(fake).toMatchObject({ status: "rejected", rejectReason: "type_not_allowed" });
    // The EICAR test string: harmless, but every scanner reports it.
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const infected = await upload(eicar, "notes.txt", "text/plain", "file");
    expect(infected).toMatchObject({ status: "rejected", rejectReason: "infected" });
    expect(await store.head(store.quarantineBucket, "missing")).toBeUndefined();
  });

  it("refuses unsupported types and oversized uploads before any bytes are sent", async () => {
    expect((await as(owner, "post", `${base()}/media/uploads`).send({ filename: "x.svg", contentType: "image/svg+xml", byteSize: 10 })).status).toBe(422);
    expect((await as(owner, "post", `${base()}/media/uploads`).send({ filename: "x.png", contentType: "image/png", byteSize: 50 * 1024 * 1024 })).status).toBe(422);
  });
});
