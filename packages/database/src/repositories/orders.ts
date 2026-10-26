import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import { deliveryOptions, discountProblem, formatMoney, isSlot, priceOrder, variantTitle, type DeliveryMethod, type DiscountRule, type PaymentMethod, type PricedOrder, type PricingLine, type ShippingAddress } from "@workeasy/commerce";
import type { Database, FulfillmentStatus, OrderEventKind, OrderEventsTable, OrderItemsTable, OrdersTable, PaymentStatus } from "../schema.js";
import { appendOutbox } from "./audit.js";
import { enabledPaymentMethods, getCheckoutSettings } from "./checkout.js";
import { recordMovement } from "./inventory.js";
import { scheduleReviewRequest } from "./reviews.js";
import { automaticRules, bookedCounts, bookingHoursOf, discountForCode, getTaxSettings, grantDownloads, listZones, redeem, releaseRedemptions, revokeDownloads } from "./rules.js";

/**
 * Orders: placement from the storefront and the merchant's actions on them.
 * Placement prices everything from current catalog data inside one
 * transaction, with the stock rows locked, so two shoppers can never buy
 * the last unit twice and nobody can choose their own price.
 */
type Trx = Transaction<Database>;

export const ORDER_PLACED_V1 = "order.placed.v1";
export const MAX_LINE_QUANTITY = 99;
export const MAX_LINES = 50;

export interface Address {
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
}

export interface PlaceOrderInput {
  storeId: string;
  items: Array<{ variantId: string; quantity: number; bookingAt?: string | null | undefined }>;
  email: string;
  name: string;
  phone: string | null;
  deliveryMethod: DeliveryMethod;
  address: Address | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  /** Whether the store has a card gateway connected and enabled. */
  cardEnabled?: boolean | undefined;
  /** The shopper's checkout record, marked converted with this order. */
  checkoutId?: string | undefined;
  /** A discount code the shopper entered. */
  discountCode?: string | null | undefined;
  /** The shipping rate the shopper chose. */
  rateId?: string | null | undefined;
  traceId?: string | undefined;
  now?: Date;
}

/** How long a shopper has to finish a card payment before the order is cancelled and its stock released. */
export const CARD_PAYMENT_WINDOW_MS = 30 * 60 * 1000;

export interface OrderProblem {
  /** Index into `items`, or undefined for problems with the order as a whole. */
  item?: number;
  code: "unavailable" | "insufficient_stock" | "booking_time" | "booking_full" | "quantity" | "delivery" | "payment" | "discount" | "empty";
  message: string;
  /** For insufficient stock: how many can still be bought. */
  available?: number;
}

export type PlaceOrderResult = { kind: "placed"; orderId: string; number: number; token: string } | { kind: "problems"; problems: OrderProblem[] };

export function hashOrderToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export interface PricingRequest {
  lines: PricingLine[];
  deliveryMethod: DeliveryMethod;
  address: ShippingAddress | null;
  rateId?: string | null | undefined;
  discountCode?: string | null | undefined;
  email?: string | null | undefined;
  currency: string;
  /** Lock discount rows, for placement. */
  lock?: boolean;
  now?: Date;
}

/**
 * Prices a cart with the store's discounts, shipping zones and tax. A code
 * the shopper entered is used if it applies; otherwise the automatic offer
 * that saves them most. Shared by the storefront's quote and placement.
 */
export async function priceCart(trx: Trx, req: PricingRequest): Promise<{ priced: PricedOrder; discountError: string | null }> {
  const now = req.now ?? new Date();
  const [settings, zones, tax] = await Promise.all([getCheckoutSettings(trx), listZones(trx), getTaxSettings(trx)]);
  const base = { lines: req.lines, deliveryMethod: req.deliveryMethod, address: req.address, zones, delivery: settings, rateId: req.rateId, tax };
  let discountError: string | null = null;
  let chosen: DiscountRule | null = null;
  if (req.discountCode?.trim()) {
    const found = await discountForCode(trx, req.discountCode, { email: req.email, now, lock: req.lock ?? false });
    if (found.kind === "invalid") discountError = found.message;
    else {
      const problem = discountProblem(found.rule, req.lines, (m) => formatMoney(m, req.currency, "en-IN", { compact: true }));
      if (problem) discountError = problem;
      else chosen = found.rule;
    }
  }
  if (!chosen) {
    let best: { rule: DiscountRule; saving: number } | undefined;
    for (const rule of await automaticRules(trx, now, req.lock ?? false)) {
      const p = priceOrder({ ...base, discount: rule });
      const saving = p.discount ? p.discount.amountMinor : 0;
      if (saving > 0 && (!best || saving > best.saving)) best = { rule, saving };
    }
    chosen = best?.rule ?? null;
  }
  return { priced: priceOrder({ ...base, discount: chosen }), discountError };
}

export async function placeOrder(trx: Trx, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const now = input.now ?? new Date();
  const problems: OrderProblem[] = [];
  if (input.items.length === 0) return { kind: "problems", problems: [{ code: "empty", message: "Your cart is empty" }] };

  const settings = await getCheckoutSettings(trx);
  const methods: PaymentMethod[] = [...(input.cardEnabled ? (["card"] as const) : []), ...enabledPaymentMethods(settings)];
  if (!methods.includes(input.paymentMethod)) {
    problems.push({ code: "payment", message: "That payment method isn't available. Choose another" });
  }

  const ids = [...new Set(input.items.map((i) => i.variantId))];
  // Lock stock rows in a fixed order so concurrent checkouts can't deadlock.
  const levels = await trx.selectFrom("inventory_levels").select(["variant_id", "on_hand", "reserved"]).where("variant_id", "in", ids).orderBy("variant_id").forUpdate().execute();
  const level = new Map(levels.map((l) => [l.variant_id, l]));
  const rows = await trx
    .selectFrom("variants as v")
    .innerJoin("products as p", "p.id", "v.product_id")
    .select([
      "v.id",
      "v.product_id",
      "v.options",
      "v.sku",
      "v.price_minor",
      "v.track_inventory",
      "v.allow_backorder",
      "v.weight_grams",
      "p.title",
      "p.type",
      "p.status",
      "p.tax_rate_bps",
      "p.booking_notice_hours",
      "p.booking_duration_minutes",
      "p.booking_capacity",
      "p.booking_hours",
      sql<string | null>`(SELECT pm.media_id FROM app.product_media pm JOIN app.media_assets m ON m.id = pm.media_id WHERE pm.product_id = p.id AND m.kind = 'image' ORDER BY pm.position LIMIT 1)`.as("image_id"),
    ])
    .where("v.id", "in", ids)
    .execute();
  const variants = new Map(rows.map((r) => [r.id, r]));
  const store = await trx.selectFrom("stores").select(["currency", "timezone"]).executeTakeFirstOrThrow();

  // Stock asked for per variant across lines (a service may appear once per slot).
  const wanted = new Map<string, number>();
  for (const item of input.items) wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity);

  const lines = input.items.map((item, index) => {
    const v = variants.get(item.variantId);
    if (!v || v.status !== "active") {
      problems.push({ item: index, code: "unavailable", message: "This item is no longer available" });
      return undefined;
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_LINE_QUANTITY) {
      problems.push({ item: index, code: "quantity", message: `Choose between 1 and ${MAX_LINE_QUANTITY}` });
    }
    if (v.track_inventory && !v.allow_backorder) {
      const l = level.get(v.id);
      const left = l ? l.on_hand - l.reserved : 0;
      if ((wanted.get(v.id) ?? 0) > left) {
        problems.push({ item: index, code: "insufficient_stock", message: left > 0 ? `Only ${left} left in stock` : "Out of stock", available: Math.max(0, left) });
      }
    }
    let bookingAt: Date | null = null;
    if (v.type === "service") {
      const at = item.bookingAt ? new Date(item.bookingAt) : undefined;
      const rules = { hours: bookingHoursOf(v.booking_hours), durationMinutes: v.booking_duration_minutes ?? 60, noticeHours: v.booking_notice_hours ?? 0, timeZone: store.timezone };
      if (!at || Number.isNaN(at.getTime())) problems.push({ item: index, code: "booking_time", message: "Choose a date and time" });
      else if (at.getTime() < now.getTime() + rules.noticeHours * 3_600_000) problems.push({ item: index, code: "booking_time", message: `Book at least ${rules.noticeHours} hours ahead` });
      else if (!isSlot(at, rules, now)) problems.push({ item: index, code: "booking_time", message: "That time isn't available. Choose another slot" });
      else bookingAt = at;
    }
    const unit = Number(v.price_minor);
    return { v, quantity: item.quantity, unit, bookingAt };
  });

  // Bookings: each slot holds the service's capacity. A per-slot lock makes two shoppers queue for the last place.
  const slotWanted = new Map<string, { productId: string; at: Date; quantity: number; capacity: number; index: number }>();
  for (const [index, l] of lines.entries()) {
    if (!l?.bookingAt) continue;
    const key = `${l.v.product_id}|${l.bookingAt.getTime()}`;
    const prev = slotWanted.get(key);
    slotWanted.set(key, { productId: l.v.product_id, at: l.bookingAt, quantity: (prev?.quantity ?? 0) + l.quantity, capacity: l.v.booking_capacity ?? 1, index: prev?.index ?? index });
  }
  for (const [key, slot] of [...slotWanted.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${key}`}, 0))`.execute(trx);
    const taken = (await bookedCounts(trx, slot.productId, slot.at, new Date(slot.at.getTime() + 1))).get(slot.at.getTime()) ?? 0;
    if (taken + slot.quantity > slot.capacity) {
      const left = Math.max(0, slot.capacity - taken);
      problems.push({ item: slot.index, code: "booking_full", message: left > 0 ? `Only ${left} place${left === 1 ? "" : "s"} left at that time` : "That time is fully booked. Choose another slot", available: left });
    }
  }

  const valid = lines.filter((l) => l !== undefined);
  const pricingLines: PricingLine[] = valid.map((l) => ({
    productId: l.v.product_id,
    productType: l.v.type,
    unitPriceMinor: l.unit,
    quantity: l.quantity,
    weightGrams: l.v.weight_grams ?? 0,
    taxRateBps: l.v.tax_rate_bps,
  }));
  const options = deliveryOptions(pricingLines, settings);
  if (!options.includes(input.deliveryMethod)) {
    problems.push({ code: "delivery", message: options.length === 0 ? "This shop isn't taking orders for delivery right now" : "Choose how you'd like to receive your order" });
  }
  if (input.deliveryMethod === "delivery" && !input.address) problems.push({ code: "delivery", message: "Enter a delivery address" });
  if (problems.length > 0) return { kind: "problems", problems };

  const { priced: sums, discountError } = await priceCart(trx, {
    lines: pricingLines,
    deliveryMethod: input.deliveryMethod,
    address: input.address,
    rateId: input.rateId,
    discountCode: input.discountCode,
    email: input.email,
    currency: store.currency,
    lock: true,
    now,
  });
  if (discountError) problems.push({ code: "discount", message: discountError });
  if (input.deliveryMethod === "delivery" && !sums.deliverable) problems.push({ code: "delivery", message: "The shop doesn't deliver to this address yet" });
  if (input.paymentMethod === "cod" && input.deliveryMethod === "delivery" && !sums.codAllowed) problems.push({ code: "payment", message: "Cash on delivery isn't available for this address. Choose another way to pay" });
  if (problems.length > 0) return { kind: "problems", problems };
  const tax = await getTaxSettings(trx);
  const customer = await trx
    .insertInto("customers")
    .values({ store_id: input.storeId, email: input.email, name: input.name, phone: input.phone })
    .onConflict((oc) => oc.columns(["store_id", "email"]).doUpdateSet({ name: input.name, phone: input.phone }))
    .returning("id")
    .executeTakeFirstOrThrow();
  const counter = await trx
    .insertInto("order_counters")
    .values({ store_id: input.storeId, last_number: 1001 })
    .onConflict((oc) => oc.column("store_id").doUpdateSet({ last_number: sql<number>`app.order_counters.last_number + 1` }))
    .returning("last_number")
    .executeTakeFirstOrThrow();
  const token = randomBytes(24).toString("base64url");
  const order = await trx
    .insertInto("orders")
    .values({
      store_id: input.storeId,
      number: counter.last_number,
      token_hash: hashOrderToken(token),
      payment_method: input.paymentMethod,
      delivery_method: input.deliveryMethod,
      customer_id: customer.id,
      email: input.email,
      name: input.name,
      phone: input.phone,
      shipping_address: input.deliveryMethod === "delivery" ? (input.address as unknown as Record<string, unknown>) : null,
      note: input.note,
      currency: store.currency,
      subtotal_minor: sums.subtotalMinor,
      discount_minor: sums.discountMinor,
      discount_code: sums.discount?.code ?? null,
      discount_title: sums.discount?.title ?? null,
      delivery_minor: sums.deliveryMinor,
      shipping_rate_name: input.deliveryMethod === "delivery" ? (sums.shippingRate?.name ?? null) : null,
      tax_minor: sums.taxMinor,
      prices_include_tax: sums.pricesIncludeTax,
      tax_label: tax.enabled ? tax.label : null,
      total_minor: sums.totalMinor,
      payment_due_at: input.paymentMethod === "card" ? new Date(now.getTime() + CARD_PAYMENT_WINDOW_MS) : null,
      placed_at: now,
    })
    .returning(["id", "number"])
    .executeTakeFirstOrThrow();

  for (const [position, line] of valid.entries()) {
    const l = line;
    const p = sums.lines[position]!;
    const takesStock = l.v.track_inventory;
    await trx
      .insertInto("order_items")
      .values({
        store_id: input.storeId,
        order_id: order.id,
        product_id: l.v.product_id,
        variant_id: l.v.id,
        product_type: l.v.type,
        title: l.v.title,
        variant_title: l.v.options.length > 0 ? variantTitle(l.v.options) : null,
        sku: l.v.sku,
        image_media_id: l.v.image_id,
        unit_price_minor: l.unit,
        quantity: l.quantity,
        total_minor: l.unit * l.quantity,
        booking_at: l.bookingAt,
        stock_taken: takesStock,
        discount_minor: p.discountMinor,
        tax_minor: p.taxMinor,
        tax_rate_bps: p.taxRateBps,
        position,
      })
      .execute();
    if (takesStock) {
      await recordMovement(trx, { storeId: input.storeId, variantId: l.v.id, delta: -l.quantity, reason: "sold", note: `Order #${order.number}`, actorId: null, orderId: order.id });
    }
  }
  await addEvent(trx, input.storeId, order.id, "placed", `Order placed by ${input.name} (${paymentLabel(input.paymentMethod)})${sums.discount ? `; ${sums.discount.code ?? sums.discount.title} applied` : ""}`, null);
  if (sums.discount) {
    await redeem(trx, { storeId: input.storeId, discountId: sums.discount.id, orderId: order.id, customerId: customer.id, amountMinor: sums.discount.amountMinor });
  }
  if (input.checkoutId) {
    await trx.updateTable("checkouts").set({ order_id: order.id }).where("id", "=", input.checkoutId).where("order_id", "is", null).execute();
  }
  await appendOutbox(trx, {
    id: randomUUID(),
    storeId: input.storeId,
    eventType: ORDER_PLACED_V1,
    aggregateId: order.id,
    occurredAt: now,
    // The shopper's link token rides along so the confirmation email can link to the
    // order. Outbox and job rows are readable only by roles that can read orders anyway.
    payload: { orderId: order.id, number: order.number, accessToken: token },
    traceId: input.traceId,
  });
  return { kind: "placed", orderId: order.id, number: order.number, token };
}

export function paymentLabel(method: PaymentMethod): string {
  return { cod: "cash on delivery", bank: "bank transfer", upi: "UPI", whatsapp: "WhatsApp order", telegram: "Telegram order", card: "online payment" }[method];
}

export async function addEvent(trx: Trx, storeId: string, orderId: string, kind: OrderEventKind, message: string, actorId: string | null): Promise<void> {
  await trx.insertInto("order_events").values({ store_id: storeId, order_id: orderId, kind, message: message.slice(0, 1000), actor_id: actorId }).execute();
}

// Reading orders ---------------------------------------------------------------------------

export interface OrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productType: "physical" | "digital" | "service";
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageId: string | null;
  unitPriceMinor: number;
  quantity: number;
  totalMinor: number;
  bookingAt: Date | null;
  discountMinor: number;
  taxMinor: number;
  taxRateBps: number;
}

export interface OrderEvent {
  id: string;
  kind: OrderEventKind;
  message: string;
  actorName: string | null;
  createdAt: Date;
}

export interface Order {
  id: string;
  number: number;
  status: "open" | "cancelled";
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  customerId: string;
  email: string;
  name: string;
  phone: string | null;
  address: Address | null;
  note: string | null;
  currency: string;
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  refundedMinor: number;
  paymentDueAt: Date | null;
  discountMinor: number;
  discountCode: string | null;
  discountTitle: string | null;
  taxMinor: number;
  pricesIncludeTax: boolean;
  /** "GST", "VAT"…; null when the store didn't charge tax. */
  taxLabel: string | null;
  shippingRateName: string | null;
  placedAt: Date;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  cancelledAt: Date | null;
}

function toOrder(r: Selectable<OrdersTable>): Order {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    paymentStatus: r.payment_status,
    fulfillmentStatus: r.fulfillment_status,
    paymentMethod: r.payment_method,
    deliveryMethod: r.delivery_method,
    customerId: r.customer_id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    address: r.shipping_address as Address | null,
    note: r.note,
    currency: r.currency,
    subtotalMinor: Number(r.subtotal_minor),
    deliveryMinor: Number(r.delivery_minor),
    totalMinor: Number(r.total_minor),
    refundedMinor: Number(r.refunded_minor),
    paymentDueAt: r.payment_due_at,
    discountMinor: Number(r.discount_minor),
    discountCode: r.discount_code,
    discountTitle: r.discount_title,
    taxMinor: Number(r.tax_minor),
    pricesIncludeTax: r.prices_include_tax,
    taxLabel: r.tax_label,
    shippingRateName: r.shipping_rate_name,
    placedAt: r.placed_at,
    paidAt: r.paid_at,
    fulfilledAt: r.fulfilled_at,
    cancelledAt: r.cancelled_at,
  };
}

function toItem(r: Selectable<OrderItemsTable>): OrderItem {
  return {
    id: r.id,
    productId: r.product_id,
    variantId: r.variant_id,
    productType: r.product_type,
    title: r.title,
    variantTitle: r.variant_title,
    sku: r.sku,
    imageId: r.image_media_id,
    unitPriceMinor: Number(r.unit_price_minor),
    quantity: r.quantity,
    totalMinor: Number(r.total_minor),
    bookingAt: r.booking_at,
    discountMinor: Number(r.discount_minor),
    taxMinor: Number(r.tax_minor),
    taxRateBps: r.tax_rate_bps,
  };
}

export async function orderItems(trx: Trx, orderId: string): Promise<OrderItem[]> {
  return (await trx.selectFrom("order_items").selectAll().where("order_id", "=", orderId).orderBy("position").execute()).map(toItem);
}

/** The order and its lines without the timeline (the worker can't read timelines). */
export async function getOrderWithItems(trx: Trx, id: string): Promise<{ order: Order; items: OrderItem[] } | undefined> {
  const row = await trx.selectFrom("orders").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? { order: toOrder(row), items: await orderItems(trx, id) } : undefined;
}

export async function getOrder(trx: Trx, id: string): Promise<{ order: Order; items: OrderItem[]; events: OrderEvent[] } | undefined> {
  const row = await trx.selectFrom("orders").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) return undefined;
  const events = await trx
    .selectFrom("order_events as e")
    .leftJoin("users as u", "u.id", "e.actor_id")
    .select(["e.id", "e.kind", "e.message", "e.created_at", "u.display_name"])
    .where("e.order_id", "=", id)
    .orderBy("e.created_at")
    .orderBy("e.id")
    .execute();
  return {
    order: toOrder(row),
    items: await orderItems(trx, id),
    events: events.map((e: Pick<Selectable<OrderEventsTable>, "id" | "kind" | "message" | "created_at"> & { display_name: string | null }) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      actorName: e.display_name ?? null,
      createdAt: e.created_at,
    })),
  };
}

/** The order a shopper's link points to, in the shop's store context. */
export async function orderByToken(trx: Trx, token: string): Promise<{ order: Order; items: OrderItem[] } | undefined> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined;
  const row = await trx.selectFrom("orders").selectAll().where("token_hash", "=", hashOrderToken(token)).executeTakeFirst();
  return row ? { order: toOrder(row), items: await orderItems(trx, row.id) } : undefined;
}

export type OrderTab = "all" | "unpaid" | "unfulfilled" | "cancelled";

export interface OrderSummary {
  id: string;
  number: number;
  name: string;
  email: string;
  status: Order["status"];
  paymentStatus: Order["paymentStatus"];
  fulfillmentStatus: Order["fulfillmentStatus"];
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  totalMinor: number;
  currency: string;
  itemCount: number;
  placedAt: Date;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Newest first, filtered by tab and a search over number, name, email and phone. */
export async function listOrders(trx: Trx, query: { tab: OrderTab; q?: string | undefined; limit: number; after?: { placedAt: string; id: string } | undefined }) {
  let q = trx
    .selectFrom("orders as o")
    .select([
      "o.id",
      "o.number",
      "o.name",
      "o.email",
      "o.status",
      "o.payment_status",
      "o.fulfillment_status",
      "o.payment_method",
      "o.delivery_method",
      "o.total_minor",
      "o.currency",
      "o.placed_at",
      sql<string>`o.placed_at::text`.as("placed_at_key"),
      sql<number>`(SELECT coalesce(sum(i.quantity), 0)::int FROM app.order_items i WHERE i.order_id = o.id)`.as("item_count"),
    ]);
  if (query.tab === "unpaid") q = q.where("o.status", "=", "open").where("o.payment_status", "=", "pending");
  if (query.tab === "unfulfilled") q = q.where("o.status", "=", "open").where("o.fulfillment_status", "=", "unfulfilled");
  if (query.tab === "cancelled") q = q.where("o.status", "=", "cancelled");
  if (query.q) {
    const term = query.q.replace(/^#/, "");
    const pattern = `%${escapeLike(term)}%`;
    q = q.where((eb) =>
      eb.or([eb("o.name", "ilike", pattern), eb("o.email", "ilike", pattern), eb("o.phone", "ilike", pattern), ...(/^\d{1,9}$/.test(term) ? [eb("o.number", "=", Number(term))] : [])]),
    );
  }
  if (query.after) q = q.where(sql<boolean>`(o.placed_at, o.id) < (${query.after.placedAt}::timestamptz, ${query.after.id}::uuid)`);
  const rows = await q.orderBy("o.placed_at", "desc").orderBy("o.id", "desc").limit(query.limit + 1).execute();
  return {
    items: rows.slice(0, query.limit).map((r) => ({
      id: r.id,
      number: r.number,
      name: r.name,
      email: r.email,
      status: r.status,
      paymentStatus: r.payment_status,
      fulfillmentStatus: r.fulfillment_status,
      paymentMethod: r.payment_method,
      deliveryMethod: r.delivery_method,
      totalMinor: Number(r.total_minor),
      currency: r.currency,
      itemCount: r.item_count,
      placedAt: r.placed_at,
      placedAtKey: r.placed_at_key,
    })),
    more: rows.length > query.limit,
  };
}

export async function orderCounts(trx: Trx): Promise<Record<OrderTab, number>> {
  const row = await trx
    .selectFrom("orders")
    .select([
      sql<number>`count(*)::int`.as("all"),
      sql<number>`count(*) FILTER (WHERE status = 'open' AND payment_status = 'pending')::int`.as("unpaid"),
      sql<number>`count(*) FILTER (WHERE status = 'open' AND fulfillment_status = 'unfulfilled')::int`.as("unfulfilled"),
      sql<number>`count(*) FILTER (WHERE status = 'cancelled')::int`.as("cancelled"),
    ])
    .executeTakeFirstOrThrow();
  return row;
}

// Merchant actions -----------------------------------------------------------------------------

export type ActionResult = "done" | "not_found" | "not_allowed";

export async function markPaid(trx: Trx, storeId: string, id: string, actorId: string): Promise<ActionResult> {
  const row = await trx
    .updateTable("orders")
    .set({ payment_status: "paid", paid_at: sql<Date>`now()` })
    .where("id", "=", id)
    .where("status", "=", "open")
    .where("payment_status", "=", "pending")
    .returning(["total_minor", "currency"])
    .executeTakeFirst();
  if (!row) return (await exists(trx, id)) ? "not_allowed" : "not_found";
  await addEvent(trx, storeId, id, "paid", "Marked as paid", actorId);
  await grantDownloads(trx, storeId, id);
  return "done";
}

/** Fulfils everything not yet fulfilled, without tracking details. */
export async function markFulfilled(trx: Trx, storeId: string, id: string, actorId: string): Promise<ActionResult> {
  const remaining = await unfulfilledQuantities(trx, id);
  const items = [...remaining.entries()].filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  if (items.length === 0) return (await exists(trx, id)) ? "not_allowed" : "not_found";
  const result = await createFulfillment(trx, { storeId, orderId: id, items, carrier: null, trackingNumber: null, trackingUrl: null, notify: false, actorId });
  return result.kind === "created" ? "done" : result.kind === "not_found" ? "not_found" : "not_allowed";
}

/** Units of each line still to fulfil: ordered minus already fulfilled. */
export async function unfulfilledQuantities(trx: Trx, orderId: string): Promise<Map<string, number>> {
  const rows = await trx
    .selectFrom("order_items as i")
    .select(["i.id", "i.quantity", sql<number>`coalesce((SELECT sum(fi.quantity) FROM app.fulfillment_items fi WHERE fi.order_item_id = i.id), 0)::int`.as("done")])
    .where("i.order_id", "=", orderId)
    .orderBy("i.position")
    .execute();
  return new Map(rows.map((r) => [r.id, r.quantity - r.done]));
}

export const ORDER_FULFILLED_V1 = "order.fulfilled.v1";

export interface FulfillmentInput {
  storeId: string;
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  notify: boolean;
  actorId: string;
}

/**
 * Records a shipment of some or all of an order's remaining units, with
 * optional tracking, and moves the order to partially fulfilled or
 * fulfilled. When `notify`, the customer is emailed the tracking details.
 */
export async function createFulfillment(
  trx: Trx,
  input: FulfillmentInput,
): Promise<{ kind: "created"; fulfillmentId: string; status: FulfillmentStatus } | { kind: "not_found" } | { kind: "not_allowed"; message: string }> {
  const order = await trx.selectFrom("orders").select(["id", "status", "number"]).where("id", "=", input.orderId).forUpdate().executeTakeFirst();
  if (!order) return { kind: "not_found" };
  if (order.status !== "open") return { kind: "not_allowed", message: "Cancelled orders can't be fulfilled" };
  if (input.items.length === 0) return { kind: "not_allowed", message: "Choose at least one item" };
  const remaining = await unfulfilledQuantities(trx, input.orderId);
  for (const item of input.items) {
    const left = remaining.get(item.orderItemId);
    if (left === undefined) return { kind: "not_allowed", message: "An item isn't part of this order" };
    if (item.quantity < 1 || item.quantity > left) return { kind: "not_allowed", message: left === 0 ? "An item is already fulfilled" : `Only ${left} of an item are left to fulfil` };
  }
  const f = await trx
    .insertInto("fulfillments")
    .values({
      store_id: input.storeId,
      order_id: input.orderId,
      carrier: input.carrier,
      tracking_number: input.trackingNumber,
      tracking_url: input.trackingUrl,
      notify_customer: input.notify,
      created_by: input.actorId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("fulfillment_items")
    .values(input.items.map((i) => ({ store_id: input.storeId, fulfillment_id: f.id, order_item_id: i.orderItemId, quantity: i.quantity })))
    .execute();
  const leftAfter = [...remaining.entries()].reduce((n, [id, q]) => n + q - (input.items.find((i) => i.orderItemId === id)?.quantity ?? 0), 0);
  const status: FulfillmentStatus = leftAfter === 0 ? "fulfilled" : "partially_fulfilled";
  await trx
    .updateTable("orders")
    .set({ fulfillment_status: status, ...(status === "fulfilled" ? { fulfilled_at: sql<Date>`now()` } : {}) })
    .where("id", "=", input.orderId)
    .execute();
  const units = input.items.reduce((n, i) => n + i.quantity, 0);
  const tracking = input.trackingNumber ? ` · ${input.carrier ? `${input.carrier} ` : ""}${input.trackingNumber}` : "";
  await addEvent(trx, input.storeId, input.orderId, "fulfilled", `${status === "fulfilled" ? "Fulfilled" : "Partly fulfilled"}: ${units} item${units === 1 ? "" : "s"}${tracking}`, input.actorId);
  // Once everything has gone out, the buyer is asked for a review a few days later.
  if (status === "fulfilled") await scheduleReviewRequest(trx, input.storeId, input.orderId);
  if (input.notify) {
    await appendOutbox(trx, {
      id: randomUUID(),
      storeId: input.storeId,
      eventType: ORDER_FULFILLED_V1,
      aggregateId: input.orderId,
      occurredAt: new Date(),
      payload: { orderId: input.orderId, fulfillmentId: f.id },
    });
  }
  return { kind: "created", fulfillmentId: f.id, status };
}

export interface Fulfillment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  items: Array<{ orderItemId: string; quantity: number }>;
  createdAt: Date;
}

export async function listFulfillments(trx: Trx, orderId: string): Promise<Fulfillment[]> {
  const rows = await trx.selectFrom("fulfillments").selectAll().where("order_id", "=", orderId).orderBy("created_at").execute();
  if (rows.length === 0) return [];
  const items = await trx.selectFrom("fulfillment_items").select(["fulfillment_id", "order_item_id", "quantity"]).where("fulfillment_id", "in", rows.map((r) => r.id)).execute();
  return rows.map((r) => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    trackingUrl: r.tracking_url,
    items: items.filter((i) => i.fulfillment_id === r.id).map((i) => ({ orderItemId: i.order_item_id, quantity: i.quantity })),
    createdAt: r.created_at,
  }));
}

/** Cancels an open order and, when asked, puts its items back in stock. */
export async function cancelOrder(trx: Trx, storeId: string, id: string, actorId: string | null, restock: boolean, reason?: string): Promise<ActionResult> {
  const row = await trx
    .updateTable("orders")
    .set({ status: "cancelled", cancelled_at: sql<Date>`now()` })
    .where("id", "=", id)
    .where("status", "=", "open")
    .returning("number")
    .executeTakeFirst();
  if (!row) return (await exists(trx, id)) ? "not_allowed" : "not_found";
  let restocked = 0;
  if (restock) {
    const items = await trx.selectFrom("order_items").select(["id", "variant_id", "quantity"]).where("order_id", "=", id).where("stock_taken", "=", true).execute();
    for (const item of items) {
      if (item.variant_id) {
        await recordMovement(trx, { storeId, variantId: item.variant_id, delta: item.quantity, reason: "cancelled", note: `Order #${row.number} cancelled`, actorId, orderId: id });
        restocked += item.quantity;
      }
      await trx.updateTable("order_items").set({ stock_taken: false }).where("id", "=", item.id).execute();
    }
  }
  await releaseRedemptions(trx, id);
  await revokeDownloads(trx, id);
  const what = reason ?? "Cancelled";
  await addEvent(trx, storeId, id, "cancelled", restock && restocked > 0 ? `${what}; ${restocked} item${restocked === 1 ? "" : "s"} returned to stock` : what, actorId);
  return "done";
}

export async function addNote(trx: Trx, storeId: string, id: string, actorId: string, note: string): Promise<ActionResult> {
  if (!(await exists(trx, id))) return "not_found";
  await addEvent(trx, storeId, id, "note", note, actorId);
  return "done";
}

async function exists(trx: Trx, id: string): Promise<boolean> {
  return (await trx.selectFrom("orders").select("id").where("id", "=", id).executeTakeFirst()) !== undefined;
}

// Dashboard ------------------------------------------------------------------------------------

/** Sales since a moment: paid revenue, orders placed (not cancelled), and the daily series for the chart. */
export async function salesSummary(trx: Trx, since: Date, timezone: string) {
  const totalsRow = await trx
    .selectFrom("orders")
    .select([
      sql<string>`coalesce(sum(total_minor) FILTER (WHERE payment_status = 'paid'), 0)`.as("revenue"),
      sql<number>`count(*) FILTER (WHERE status = 'open')::int`.as("orders"),
      sql<number>`count(*) FILTER (WHERE payment_status = 'paid')::int`.as("paid"),
      sql<string>`coalesce(sum(total_minor) FILTER (WHERE status = 'open'), 0)`.as("booked"),
    ])
    .where("placed_at", ">=", since)
    .executeTakeFirstOrThrow();
  const days = await trx
    .selectFrom("orders")
    .select([sql<string>`(placed_at AT TIME ZONE ${timezone})::date::text`.as("day"), sql<string>`coalesce(sum(total_minor), 0)`.as("total")])
    .where("placed_at", ">=", since)
    .where("status", "=", "open")
    .groupBy(sql`1`)
    .orderBy(sql`1`)
    .execute();
  return {
    revenueMinor: Number(totalsRow.revenue),
    orders: totalsRow.orders,
    paidOrders: totalsRow.paid,
    bookedMinor: Number(totalsRow.booked),
    daily: days.map((d) => ({ day: d.day, totalMinor: Number(d.total) })),
  };
}
