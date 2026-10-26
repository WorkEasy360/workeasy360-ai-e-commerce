import { DEFAULT_HOURS, NO_TAX, type DiscountRule, type ShippingZone, type TaxSettings, type WeeklyHours } from "@workeasy/commerce";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, DiscountKind, DiscountMethod, DiscountsTable } from "../schema.js";
import { getCollection, productIdsIn } from "./collections.js";

/**
 * Commerce rules: offers, shipping zones and rates, tax settings, booking
 * capacity and digital download grants. Everything runs in the caller's
 * store-scoped transaction.
 */
type Trx = Transaction<Database>;

// Offers --------------------------------------------------------------------------------------------

export interface Discount {
  id: string;
  method: DiscountMethod;
  code: string | null;
  title: string;
  type: DiscountKind;
  value: number;
  minSubtotalMinor: number | null;
  appliesTo: "all" | "collections" | "products";
  targetIds: string[];
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  usageCount: number;
  enabled: boolean;
  /** Buy X get Y only; null otherwise. */
  buyXGetY: BuyXGetYSettings | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a buy X get Y offer asks for and gives. `getAppliesTo: "same"` gets from the products bought. */
export interface BuyXGetYSettings {
  buyQuantity: number;
  getQuantity: number;
  getAppliesTo: "same" | "collections" | "products";
  getTargetIds: string[];
  maxApplications: number | null;
}

export type DiscountStatus = "active" | "scheduled" | "expired" | "used_up" | "disabled";

export function discountStatus(d: Pick<Discount, "enabled" | "startsAt" | "endsAt" | "usageLimit" | "usageCount">, now = new Date()): DiscountStatus {
  if (!d.enabled) return "disabled";
  if (d.startsAt > now) return "scheduled";
  if (d.endsAt && d.endsAt <= now) return "expired";
  if (d.usageLimit !== null && d.usageCount >= d.usageLimit) return "used_up";
  return "active";
}

function toDiscount(r: Selectable<DiscountsTable>): Discount {
  return {
    id: r.id,
    method: r.method,
    code: r.code,
    title: r.title,
    type: r.type,
    value: Number(r.value),
    minSubtotalMinor: r.min_subtotal_minor === null ? null : Number(r.min_subtotal_minor),
    appliesTo: r.applies_to,
    targetIds: r.target_ids,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    usageLimit: r.usage_limit,
    oncePerCustomer: r.once_per_customer,
    usageCount: r.usage_count,
    enabled: r.enabled,
    buyXGetY:
      r.type === "buy_x_get_y" && r.buy_quantity !== null && r.get_quantity !== null
        ? { buyQuantity: r.buy_quantity, getQuantity: r.get_quantity, getAppliesTo: r.get_applies_to ?? "same", getTargetIds: r.get_target_ids, maxApplications: r.max_applications }
        : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface DiscountInput {
  method: DiscountMethod;
  code: string | null;
  title: string;
  type: DiscountKind;
  value: number;
  minSubtotalMinor: number | null;
  appliesTo: "all" | "collections" | "products";
  targetIds: string[];
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  enabled: boolean;
  buyXGetY: BuyXGetYSettings | null;
}

function discountRow(d: DiscountInput) {
  const bxgy = d.type === "buy_x_get_y" ? d.buyXGetY : null;
  return {
    method: d.method,
    code: d.method === "code" ? d.code : null,
    title: d.title,
    type: d.type,
    value: d.type === "free_shipping" ? 0 : d.value,
    min_subtotal_minor: d.minSubtotalMinor,
    applies_to: d.appliesTo,
    target_ids: d.appliesTo === "all" ? [] : d.targetIds,
    starts_at: d.startsAt,
    ends_at: d.endsAt,
    usage_limit: d.usageLimit,
    once_per_customer: d.oncePerCustomer,
    enabled: d.enabled,
    buy_quantity: bxgy?.buyQuantity ?? null,
    get_quantity: bxgy?.getQuantity ?? null,
    get_applies_to: bxgy?.getAppliesTo ?? null,
    get_target_ids: bxgy && bxgy.getAppliesTo !== "same" ? bxgy.getTargetIds : [],
    max_applications: bxgy?.maxApplications ?? null,
  };
}

export async function listDiscounts(trx: Trx): Promise<Discount[]> {
  return (await trx.selectFrom("discounts").selectAll().orderBy("created_at", "desc").limit(500).execute()).map(toDiscount);
}

export async function getDiscount(trx: Trx, id: string): Promise<Discount | undefined> {
  const r = await trx.selectFrom("discounts").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? toDiscount(r) : undefined;
}

export async function createDiscount(trx: Trx, storeId: string, d: DiscountInput): Promise<Discount> {
  return toDiscount(await trx.insertInto("discounts").values({ store_id: storeId, ...discountRow(d) }).returningAll().executeTakeFirstOrThrow());
}

export async function updateDiscount(trx: Trx, id: string, d: DiscountInput): Promise<Discount | undefined> {
  const r = await trx.updateTable("discounts").set(discountRow(d)).where("id", "=", id).returningAll().executeTakeFirst();
  return r ? toDiscount(r) : undefined;
}

export async function deleteDiscount(trx: Trx, id: string): Promise<boolean> {
  return Number((await trx.deleteFrom("discounts").where("id", "=", id).executeTakeFirst()).numDeletedRows) > 0;
}

/** A unique-code violation, for "that code is taken". */
export function isCodeConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "constraint" in err && (err as { constraint?: string }).constraint === "discounts_code_idx";
}

export async function redemptionTotals(trx: Trx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await trx.selectFrom("discount_redemptions").select(["discount_id", sql<string>`sum(amount_minor)`.as("total")]).where("discount_id", "in", ids).groupBy("discount_id").execute();
  return new Map(rows.map((r) => [r.discount_id, Number(r.total)]));
}

async function productScope(trx: Trx, appliesTo: "all" | "collections" | "products", targetIds: readonly string[]): Promise<ReadonlySet<string> | null> {
  if (appliesTo === "all") return null;
  if (appliesTo === "products") return new Set(targetIds);
  const ids = new Set<string>();
  for (const id of targetIds) {
    const c = await getCollection(trx, id);
    if (c) for (const p of await productIdsIn(trx, c, 5000)) ids.add(p);
  }
  return ids;
}

async function toRule(trx: Trx, d: Discount): Promise<DiscountRule> {
  const productIds = await productScope(trx, d.appliesTo, d.targetIds);
  const offer = d.buyXGetY;
  const buyXGetY = offer
    ? {
        buyQuantity: offer.buyQuantity,
        getQuantity: offer.getQuantity,
        getProductIds: offer.getAppliesTo === "same" ? productIds : await productScope(trx, offer.getAppliesTo, offer.getTargetIds),
        maxApplications: offer.maxApplications,
      }
    : undefined;
  return { id: d.id, code: d.code, title: d.title, type: d.type, value: d.value, minSubtotalMinor: d.minSubtotalMinor, productIds, buyXGetY };
}

export type CodeLookup = { kind: "ok"; rule: DiscountRule } | { kind: "invalid"; message: string };

/**
 * The discount for a code a shopper entered, if it can be used now (and by
 * this shopper, when their email is known). `lock` takes the row lock that
 * order placement needs to count the use safely.
 */
export async function discountForCode(trx: Trx, code: string, opts: { email?: string | null | undefined; now?: Date; lock?: boolean } = {}): Promise<CodeLookup> {
  const normalized = code.trim().toUpperCase();
  let q = trx.selectFrom("discounts").selectAll().where("code", "=", normalized).where("method", "=", "code");
  if (opts.lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) return { kind: "invalid", message: "That code isn't valid" };
  const d = toDiscount(row);
  const status = discountStatus(d, opts.now);
  if (status === "scheduled") return { kind: "invalid", message: "That code isn't active yet" };
  if (status === "expired") return { kind: "invalid", message: "That code has expired" };
  if (status === "used_up") return { kind: "invalid", message: "That code has been fully used" };
  if (status === "disabled") return { kind: "invalid", message: "That code isn't valid" };
  if (d.oncePerCustomer && opts.email) {
    const used = await trx
      .selectFrom("discount_redemptions as r")
      .innerJoin("customers as c", "c.id", "r.customer_id")
      .select("r.order_id")
      .where("r.discount_id", "=", d.id)
      .where("c.email", "=", opts.email.trim().toLowerCase())
      .executeTakeFirst();
    if (used) return { kind: "invalid", message: "You've already used this code" };
  }
  return { kind: "ok", rule: await toRule(trx, d) };
}

/** Automatic discounts running now; the API applies whichever saves the shopper most. */
export async function automaticRules(trx: Trx, now = new Date(), lock = false): Promise<DiscountRule[]> {
  let q = trx
    .selectFrom("discounts")
    .selectAll()
    .where("method", "=", "automatic")
    .where("enabled", "=", true)
    .where("starts_at", "<=", now)
    .where((eb) => eb.or([eb("ends_at", "is", null), eb("ends_at", ">", now)]))
    .where((eb) => eb.or([eb("usage_limit", "is", null), eb("usage_count", "<", eb.ref("usage_limit"))]))
    .orderBy("id");
  if (lock) q = q.forUpdate();
  const rows = await q.execute();
  return Promise.all(rows.map((r) => toRule(trx, toDiscount(r))));
}

/** Records a discount's use by an order, counting it against any limit. */
export async function redeem(trx: Trx, input: { storeId: string; discountId: string; orderId: string; customerId: string; amountMinor: number }): Promise<void> {
  await trx.insertInto("discount_redemptions").values({ store_id: input.storeId, discount_id: input.discountId, order_id: input.orderId, customer_id: input.customerId, amount_minor: input.amountMinor }).execute();
  await trx.updateTable("discounts").set((eb) => ({ usage_count: eb("usage_count", "+", 1) })).where("id", "=", input.discountId).execute();
}

/** Gives a cancelled order's discount use back, so a limited offer isn't spent by orders that never happened. */
export async function releaseRedemptions(trx: Trx, orderId: string): Promise<void> {
  const rows = await trx.deleteFrom("discount_redemptions").where("order_id", "=", orderId).returning("discount_id").execute();
  for (const r of rows) {
    await trx.updateTable("discounts").set((eb) => ({ usage_count: sql<number>`greatest(${eb.ref("usage_count")} - 1, 0)` })).where("id", "=", r.discount_id).execute();
  }
}

// Shipping --------------------------------------------------------------------------------------------

export interface ZoneInput {
  name: string;
  countries: string[];
  regions: string[];
  postalPrefixes: string[];
  codEnabled: boolean;
  rates: Array<{ name: string; kind: "flat" | "weight" | "price"; minValue: number | null; maxValue: number | null; priceMinor: number; freeOverMinor: number | null; deliveryTime: string | null }>;
}

/** Zones in matching order, each with its rates. */
export async function listZones(trx: Trx): Promise<ShippingZone[]> {
  const zones = await trx.selectFrom("shipping_zones").selectAll().orderBy("position").orderBy("created_at").execute();
  if (zones.length === 0) return [];
  const rates = await trx.selectFrom("shipping_rates").selectAll().orderBy("position").execute();
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    countries: z.countries,
    regions: z.regions,
    postalPrefixes: z.postal_prefixes,
    codEnabled: z.cod_enabled,
    rates: rates
      .filter((r) => r.zone_id === z.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        minValue: r.min_value === null ? null : Number(r.min_value),
        maxValue: r.max_value === null ? null : Number(r.max_value),
        priceMinor: Number(r.price_minor),
        freeOverMinor: r.free_over_minor === null ? null : Number(r.free_over_minor),
        deliveryTime: r.delivery_time,
      })),
  }));
}

async function writeRates(trx: Trx, storeId: string, zoneId: string, rates: ZoneInput["rates"]): Promise<void> {
  await trx.deleteFrom("shipping_rates").where("zone_id", "=", zoneId).execute();
  if (rates.length === 0) return;
  await trx
    .insertInto("shipping_rates")
    .values(
      rates.map((r, position) => ({
        store_id: storeId,
        zone_id: zoneId,
        name: r.name,
        kind: r.kind,
        min_value: r.kind === "flat" ? null : r.minValue,
        max_value: r.kind === "flat" ? null : r.maxValue,
        price_minor: r.priceMinor,
        free_over_minor: r.freeOverMinor,
        delivery_time: r.deliveryTime,
        position,
      })),
    )
    .execute();
}

function zoneRow(z: ZoneInput) {
  return { name: z.name, countries: z.countries, regions: z.regions, postal_prefixes: z.postalPrefixes, cod_enabled: z.codEnabled };
}

export async function createZone(trx: Trx, storeId: string, z: ZoneInput): Promise<string> {
  const position = (await trx.selectFrom("shipping_zones").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow()).n;
  const row = await trx.insertInto("shipping_zones").values({ store_id: storeId, ...zoneRow(z), position: Math.min(position, 99) }).returning("id").executeTakeFirstOrThrow();
  await writeRates(trx, storeId, row.id, z.rates);
  return row.id;
}

export async function updateZone(trx: Trx, storeId: string, id: string, z: ZoneInput): Promise<boolean> {
  const row = await trx.updateTable("shipping_zones").set(zoneRow(z)).where("id", "=", id).returning("id").executeTakeFirst();
  if (!row) return false;
  await writeRates(trx, storeId, id, z.rates);
  return true;
}

export async function deleteZone(trx: Trx, id: string): Promise<boolean> {
  return Number((await trx.deleteFrom("shipping_zones").where("id", "=", id).executeTakeFirst()).numDeletedRows) > 0;
}

/** Sets the matching order; ids not listed keep their place after the listed ones. */
export async function reorderZones(trx: Trx, ids: readonly string[]): Promise<void> {
  for (const [position, id] of ids.entries()) await trx.updateTable("shipping_zones").set({ position: Math.min(position, 99) }).where("id", "=", id).execute();
}

// Tax -------------------------------------------------------------------------------------------------

export interface StoreTaxSettings extends TaxSettings {
  registrationNumber: string | null;
}

export async function getTaxSettings(trx: Trx): Promise<StoreTaxSettings> {
  const r = await trx.selectFrom("tax_settings").selectAll().executeTakeFirst();
  if (!r) return { ...NO_TAX, label: "GST", registrationNumber: null };
  return { enabled: r.enabled, pricesIncludeTax: r.prices_include_tax, defaultRateBps: r.default_rate_bps, taxShipping: r.tax_shipping, label: r.label, registrationNumber: r.registration_number };
}

export async function saveTaxSettings(trx: Trx, storeId: string, t: StoreTaxSettings): Promise<StoreTaxSettings> {
  const values = { enabled: t.enabled, prices_include_tax: t.pricesIncludeTax, default_rate_bps: t.defaultRateBps, tax_shipping: t.taxShipping, label: t.label, registration_number: t.registrationNumber };
  await trx
    .insertInto("tax_settings")
    .values({ store_id: storeId, ...values })
    .onConflict((oc) => oc.column("store_id").doUpdateSet(values))
    .execute();
  return getTaxSettings(trx);
}

// Bookings --------------------------------------------------------------------------------------------

export function bookingHoursOf(stored: Record<string, Array<[string, string]>> | null): WeeklyHours {
  return stored ? ({ ...DEFAULT_HOURS, ...stored } as WeeklyHours) : DEFAULT_HOURS;
}

/** Places taken per slot start for a service, from orders that weren't cancelled. */
export async function bookedCounts(trx: Trx, productId: string, from: Date, to: Date): Promise<Map<number, number>> {
  const rows = await trx
    .selectFrom("order_items as i")
    .innerJoin("orders as o", "o.id", "i.order_id")
    .select(["i.booking_at", sql<number>`sum(i.quantity)::int`.as("n")])
    .where("i.product_id", "=", productId)
    .where("i.booking_at", ">=", from)
    .where("i.booking_at", "<", to)
    .where("o.status", "=", "open")
    .groupBy("i.booking_at")
    .execute();
  return new Map(rows.map((r) => [r.booking_at!.getTime(), r.n]));
}

export interface Booking {
  orderId: string;
  orderNumber: number;
  customer: string;
  email: string;
  phone: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  at: Date;
  paymentStatus: string;
}

/** Bookings from a moment on (upcoming first), across services. */
export async function listBookings(trx: Trx, opts: { from: Date; to?: Date | undefined; limit: number }): Promise<Booking[]> {
  let q = trx
    .selectFrom("order_items as i")
    .innerJoin("orders as o", "o.id", "i.order_id")
    .select(["o.id", "o.number", "o.name", "o.email", "o.phone", "o.payment_status", "i.title", "i.variant_title", "i.quantity", "i.booking_at"])
    .where("i.booking_at", "is not", null)
    .where("i.booking_at", ">=", opts.from)
    .where("o.status", "=", "open");
  if (opts.to) q = q.where("i.booking_at", "<", opts.to);
  const rows = await q.orderBy("i.booking_at").orderBy("o.number").limit(opts.limit).execute();
  return rows.map((r) => ({
    orderId: r.id,
    orderNumber: r.number,
    customer: r.name,
    email: r.email,
    phone: r.phone,
    title: r.title,
    variantTitle: r.variant_title,
    quantity: r.quantity,
    at: r.booking_at!,
    paymentStatus: r.payment_status,
  }));
}

// Digital downloads -----------------------------------------------------------------------------------

/**
 * Gives a paid order's digital items their downloads: one grant per file,
 * with the product's limit and expiry. Safe to call more than once.
 */
export async function grantDownloads(trx: Trx, storeId: string, orderId: string, now = new Date()): Promise<number> {
  const files = await trx
    .selectFrom("order_items as i")
    .innerJoin("products as p", "p.id", "i.product_id")
    .innerJoin("product_files as f", "f.product_id", "p.id")
    .innerJoin("media_assets as m", "m.id", "f.media_id")
    .select(["i.id as item_id", "f.media_id", "m.filename", "p.download_limit", "p.download_expiry_days"])
    .where("i.order_id", "=", orderId)
    .where("i.product_type", "=", "digital")
    .where("m.status", "=", "ready")
    .orderBy("i.position")
    .orderBy("f.position")
    .execute();
  if (files.length === 0) return 0;
  const r = await trx
    .insertInto("download_grants")
    .values(
      files.map((f) => ({
        store_id: storeId,
        order_id: orderId,
        order_item_id: f.item_id,
        media_id: f.media_id,
        file_name: f.filename.slice(0, 255),
        download_limit: f.download_limit,
        expires_at: f.download_expiry_days ? new Date(now.getTime() + f.download_expiry_days * 86_400_000) : null,
      })),
    )
    .onConflict((oc) => oc.columns(["order_item_id", "media_id"]).doNothing())
    .returning("id")
    .execute();
  return r.length;
}

export interface DownloadGrant {
  id: string;
  orderItemId: string;
  fileName: string;
  downloadLimit: number | null;
  downloadsUsed: number;
  expiresAt: Date | null;
  usable: boolean;
}

export async function orderDownloads(trx: Trx, orderId: string, now = new Date()): Promise<DownloadGrant[]> {
  const rows = await trx.selectFrom("download_grants").selectAll().where("order_id", "=", orderId).orderBy("created_at").orderBy("id").execute();
  return rows.map((g) => ({
    id: g.id,
    orderItemId: g.order_item_id,
    fileName: g.file_name,
    downloadLimit: g.download_limit,
    downloadsUsed: g.downloads_used,
    expiresAt: g.expires_at,
    usable: g.revoked_at === null && (g.expires_at === null || g.expires_at > now) && (g.download_limit === null || g.downloads_used < g.download_limit),
  }));
}

/** Counts one download and returns the file to serve, or why it can't be downloaded. */
export async function useDownload(
  trx: Trx,
  orderId: string,
  grantId: string,
  now = new Date(),
): Promise<{ kind: "ok"; storageKey: string; fileName: string; contentType: string } | { kind: "not_found" } | { kind: "expired" } | { kind: "limit" }> {
  const g = await trx.selectFrom("download_grants").selectAll().where("id", "=", grantId).where("order_id", "=", orderId).forUpdate().executeTakeFirst();
  if (!g || g.revoked_at) return { kind: "not_found" };
  if (g.expires_at && g.expires_at <= now) return { kind: "expired" };
  if (g.download_limit !== null && g.downloads_used >= g.download_limit) return { kind: "limit" };
  const media = await trx.selectFrom("media_assets").select(["storage_key", "content_type", "status"]).where("id", "=", g.media_id).executeTakeFirst();
  if (!media || media.status !== "ready" || !media.content_type) return { kind: "not_found" };
  await trx.updateTable("download_grants").set({ downloads_used: g.downloads_used + 1 }).where("id", "=", g.id).execute();
  return { kind: "ok", storageKey: media.storage_key, fileName: g.file_name, contentType: media.content_type };
}

/** Stops an order's downloads (cancelled or fully refunded). */
export async function revokeDownloads(trx: Trx, orderId: string): Promise<void> {
  await trx.updateTable("download_grants").set({ revoked_at: sql<Date>`now()` }).where("order_id", "=", orderId).where("revoked_at", "is", null).execute();
}
