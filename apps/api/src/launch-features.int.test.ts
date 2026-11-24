import { randomUUID } from "node:crypto";
import { createDb, identityRepo, type Db } from "@workeasy/database";
import type { TestDatabaseUrls } from "@workeasy/database/testing";
import { FIXTURE_ISSUER } from "@workeasy/test-fixtures";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildTestApp, TEST_ADMIN_ORIGIN, testSettings, unusedIdentityProvider } from "./test-support.js";

/**
 * Launch-gated features (COMMERCE_FEATURES) with every one off, as on a
 * server that hasn't turned them on: the server refuses new bookable
 * services, buy X get Y offers and Stripe connections, whatever the admin
 * shows. Needs `pnpm infra:up`.
 */
const urls: TestDatabaseUrls = inject("testDatabase");

let db: Db;
let app: Express;
let owner: string;
let storeId: string;

const as = (method: "get" | "post" | "put", path: string) => request(app)[method](path).set("Cookie", `wec_session=${owner}`).set("Origin", TEST_ADMIN_ORIGIN);
const admin = () => `/api/v1/stores/${storeId}`;
const hours = { mon: [["10:00", "12:00"]], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const service = { type: "service", status: "active", title: "Tea Tasting", bookingDurationMinutes: 60, bookingNoticeHours: 1, bookingCapacity: 2, bookingHours: hours, variants: [{ options: [], priceMinor: 150000, trackInventory: false, stock: null }] };

beforeAll(async () => {
  db = createDb({ connectionString: urls.api, maxConnections: 2 });
  app = buildTestApp(db, unusedIdentityProvider, { ...testSettings, features: [] });
  const id = await identityRepo.findOrCreateUser(db, { issuer: FIXTURE_ISSUER, subject: `gated-${randomUUID()}` });
  owner = (await identityRepo.createSession(db, id, 3_600_000)).token;
  storeId = (await as("post", "/api/v1/stores").send({ name: "Gated Tea", slug: `gated-${randomUUID().slice(0, 8)}` })).body.store.id;
});

afterAll(async () => {
  await db.destroy();
});

describe("launch-gated features, all off", () => {
  it("tells the admin which features are on", async () => {
    expect((await as("get", "/api/v1/me")).body.features).toEqual([]);
  });

  it("refuses new bookable services, from the form and from a spreadsheet", async () => {
    const r = await as("post", `${admin()}/products`).send(service);
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([expect.objectContaining({ field: "type" })]);

    const tea = await as("post", `${admin()}/products`).send({ type: "physical", status: "active", title: "Assam Tea", variants: [{ options: [], priceMinor: 30000, stock: 3 }] });
    expect(tea.status).toBe(201);
    expect((await as("put", `${admin()}/products/${tea.body.product.id}`).send(service)).status).toBe(422);

    const csv = "Handle,Title,Type,Price\ntasting,Tea Tasting,service,1500\n";
    const preview = await as("post", `${admin()}/products/import`).set("Content-Type", "text/csv").send(csv);
    expect(preview.body.problems).toEqual([{ row: 2, message: expect.stringMatching(/services aren't available yet/) }]);
    expect(preview.body.create).toBe(0);
  });

  it("refuses new buy X get Y offers but still allows the others", async () => {
    const bxgy = { method: "automatic", title: "3 for 2", type: "buy_x_get_y", value: 10_000, appliesTo: "all", targetIds: [], buyXGetY: { buyQuantity: 2, getQuantity: 1 } };
    const r = await as("post", `${admin()}/discounts`).send(bxgy);
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([expect.objectContaining({ field: "type" })]);
    expect((await as("post", `${admin()}/discounts`).send({ method: "code", code: "TEN", title: "10% off", type: "percentage", value: 1000, appliesTo: "all", targetIds: [] })).status).toBe(201);
  });

  it("refuses to connect Stripe", async () => {
    const r = await as("put", `${admin()}/payment-accounts/stripe`).send({ publicKey: "pk_test_0123456789", secretKey: "sk_test_0123456789", webhookSecret: "whsec_0123456789" });
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([expect.objectContaining({ field: "provider" })]);
  });
});
