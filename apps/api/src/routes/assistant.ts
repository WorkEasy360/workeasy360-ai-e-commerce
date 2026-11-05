import type { Response, Router } from "express";
import { ASSISTANT_ACTIONS, ASSISTANT_TOOLS, assistantCapabilities, assistantSystem, runAssistantTurn, type AssistantMessage, type Navigation, type NewDiscount, type NewProduct, type ProductChanges, type ProposedAction } from "@workeasy/ai";
import { storePermissions, type StorePermission } from "@workeasy/auth";
import { aiRepo, analyticsRepo, checkoutRepo, identityRepo, inventoryRepo, moneyRepo, ordersRepo, productsRepo, reviewsRepo, rulesRepo, storesRepo } from "@workeasy/database";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { problems, sendProblem } from "../http/problem.js";
import { ProductBodySchema } from "../contract/catalog.js";
import { DiscountBodySchema } from "../contract/rules.js";
import { analyticsReport } from "./engagement.js";
import { issuesToErrors, NOT_VISIBLE, respond, sessionOf, UUID_PATTERN, type StoreAccess, type Trx } from "./support.js";

/**
 * The admin assistant (packages/ai/src/assistant.ts). One POST is one
 * question: the API checks the member and the day's allowance, runs the
 * model, and runs each tool the model asks for in its own short transaction
 * scoped to this store and re-checked against the member's role. Nothing is
 * changed here: a proposed action is verified and returned for the member to
 * confirm, and the admin then calls the existing, audited endpoint.
 */

const MessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) });
const AskBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Earlier messages, oldest first; only the last few are sent to the model. */
  history: z.array(MessageSchema).max(40).default([]),
});

const HISTORY_SENT = 12;
const clamp = (v: unknown, min: number, max: number, fallback: number) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback);
const text = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

/** The read-only tools. Each runs inside the member's store transaction; the caller has checked the permission. */
const TOOLS: Record<string, (trx: Trx, args: Record<string, unknown>, ctx: { storeId: string; storefrontOrigin: string; perms: ReadonlySet<string> }) => Promise<ToolResult>> = {
  async store_overview(trx, _args, ctx) {
    const store = (await storesRepo.getStore(trx))!;
    const counts = ctx.perms.has("products.read") ? await productsRepo.statusCounts(trx) : undefined;
    const orders = ctx.perms.has("orders.read") ? await ordersRepo.orderCounts(trx) : undefined;
    return {
      ok: true,
      result: { name: store.name, status: store.status, storefront: `${ctx.storefrontOrigin}/s/${store.slug}`, currency: store.currency, country: store.country, timeZone: store.timezone, today: analyticsRepo.today(store.timezone), products: counts, orders },
    };
  },
  async search_products(trx, args) {
    const status = ["active", "draft", "archived"].includes(args.status as string) ? (args.status as "active") : undefined;
    const { items } = await productsRepo.listProducts(trx, { q: text(args.query), status, limit: clamp(args.limit, 1, 10, 10) });
    return { ok: true, result: { items: items.map((p) => ({ id: p.id, title: p.title, status: p.status, type: p.type, priceMinMinor: p.priceMin, priceMaxMinor: p.priceMax, variants: p.variantCount, stock: p.stock })) } };
  },
  async get_product(trx, args) {
    const id = text(args.id, 40);
    if (!id || !UUID_PATTERN.test(id)) return { ok: false, error: "Give a product id from search_products" };
    const p = await productsRepo.getProduct(trx, id);
    if (!p) return { ok: false, error: "No product with that id in this store" };
    return {
      ok: true,
      result: {
        id: p.id, title: p.title, status: p.status, type: p.type, handle: p.handle, vendor: p.vendor, tags: p.tags, seoTitle: p.seoTitle,
        description: p.description.slice(0, 600),
        variants: p.variants.slice(0, 30).map((v) => ({ options: v.options, sku: v.sku, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, tracked: v.trackInventory, onHand: v.onHand, reserved: v.reserved })),
      },
    };
  },
  async search_orders(trx, args) {
    const tab = ["unpaid", "unfulfilled", "cancelled"].includes(args.filter as string) ? (args.filter as "unpaid") : "all";
    const { items } = await ordersRepo.listOrders(trx, { tab, q: text(args.query), limit: clamp(args.limit, 1, 10, 10) });
    return {
      ok: true,
      result: { items: items.map((o) => ({ number: o.number, customer: o.name, email: o.email, status: o.status, payment: o.paymentStatus, fulfilment: o.fulfillmentStatus, paymentMethod: o.paymentMethod, delivery: o.deliveryMethod, totalMinor: o.totalMinor, currency: o.currency, items: o.itemCount, placedAt: o.placedAt.toISOString() })) },
    };
  },
  async get_order(trx, args) {
    const number = clamp(args.number, 1, 999_999_999, 0);
    const found = number ? await orderByNumber(trx, number) : undefined;
    if (!found) return { ok: false, error: "No order with that number in this store" };
    const { order: o, items, events } = (await ordersRepo.getOrder(trx, found))!;
    return {
      ok: true,
      result: {
        number: o.number, customer: o.name, email: o.email, status: o.status, payment: o.paymentStatus, fulfilment: o.fulfillmentStatus, paymentMethod: o.paymentMethod, delivery: o.deliveryMethod,
        deliverTo: o.address ? { city: o.address.city, state: o.address.state, postalCode: o.address.postalCode } : null,
        currency: o.currency, subtotalMinor: o.subtotalMinor, discountMinor: o.discountMinor, discountCode: o.discountCode, deliveryMinor: o.deliveryMinor, taxMinor: o.taxMinor, taxIncluded: o.pricesIncludeTax, totalMinor: o.totalMinor, refundedMinor: o.refundedMinor,
        paymentDueAt: o.paymentDueAt?.toISOString() ?? null,
        items: items.map((i) => ({ title: i.title, variant: i.variantTitle, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor, bookingAt: i.bookingAt?.toISOString() ?? null })),
        timeline: events.slice(-12).map((e) => ({ kind: e.kind, message: e.message, at: e.createdAt.toISOString() })),
      },
    };
  },
  async search_customers(trx, args) {
    const { items, total } = await moneyRepo.listCustomers(trx, { q: text(args.query), limit: clamp(args.limit, 1, 10, 10), offset: 0 });
    return { ok: true, result: { total, items: items.map((c) => ({ name: c.name, email: c.email, orders: c.orders, spentMinor: c.spentMinor, lastOrderAt: c.lastOrderAt?.toISOString() ?? null })) } };
  },
  async stock_report(trx, args) {
    const filter = ["low", "out", "all"].includes(args.filter as string) ? (args.filter as "low") : "low";
    const [{ rows }, summary] = await Promise.all([inventoryRepo.listInventory(trx, { q: text(args.query), filter, limit: clamp(args.limit, 1, 20, 20) }), inventoryRepo.stockSummary(trx)]);
    return { ok: true, result: { summary, items: rows.map((r) => ({ product: r.productTitle, options: r.options, sku: r.sku, onHand: r.onHand, reserved: r.reserved, available: r.available, lowStockThreshold: r.lowStockThreshold })) } };
  },
  async sales_report(trx, args, ctx) {
    const days = [7, 30, 90].includes(args.days as number) ? (args.days as number) : 30;
    const r = await analyticsReport(trx, ctx.storeId, days);
    return { ok: true, result: { from: r.from, to: r.to, timeZone: r.timeZone, currency: r.currency, totals: r.totals, previousPeriod: r.previous, funnel: r.funnel, sources: r.sources.slice(0, 6), topProducts: r.topProducts.slice(0, 6), customers: r.customers } };
  },
  async list_bookings(trx, args) {
    const from = typeof args.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? new Date(`${args.from}T00:00:00Z`) : new Date(Date.now() - 2 * 3_600_000);
    if (Number.isNaN(from.getTime())) return { ok: false, error: "Use a date like 2026-11-02" };
    const days = clamp(args.days, 1, 31, 7);
    const items = await rulesRepo.listBookings(trx, { from, to: new Date(from.getTime() + days * 86_400_000), limit: 50 });
    return { ok: true, result: { from: from.toISOString(), days, items: items.map((b) => ({ at: b.at.toISOString(), service: b.title, option: b.variantTitle, quantity: b.quantity, customer: b.customer, orderNumber: b.orderNumber, payment: b.paymentStatus })) } };
  },
  async list_offers(trx) {
    const offers = await rulesRepo.listDiscounts(trx);
    return {
      ok: true,
      result: {
        items: offers.slice(0, 30).map((d) => ({ title: d.title, code: d.code, method: d.method, type: d.type, value: d.value, minSubtotalMinor: d.minSubtotalMinor, appliesTo: d.appliesTo, startsAt: d.startsAt.toISOString(), endsAt: d.endsAt?.toISOString() ?? null, usageLimit: d.usageLimit, used: d.usageCount, oncePerCustomer: d.oncePerCustomer, enabled: d.enabled })),
      },
    };
  },
  async pending_reviews(trx, args) {
    const { items, total } = await reviewsRepo.listReviews(trx, { status: "pending", limit: clamp(args.limit, 1, 10, 5), offset: 0 });
    return { ok: true, result: { total, items: items.map((r) => ({ product: r.productTitle, rating: r.rating, title: r.title, excerpt: r.body.slice(0, 200), author: r.authorName, orderNumber: r.orderNumber })) } };
  },
  async payment_setup(trx) {
    const [accounts, c] = await Promise.all([moneyRepo.listAccounts(trx), checkoutRepo.getCheckoutSettings(trx)]);
    return {
      ok: true,
      result: {
        // Provider, mode and status only: keys and hints never leave the server.
        cardGateways: accounts.map((a) => ({ provider: a.provider, mode: a.mode, enabled: a.enabled })),
        whatsapp: Boolean(c.whatsappNumber), telegram: Boolean(c.telegramUsername), upi: c.upiEnabled, bankTransfer: c.bankEnabled, cashOnDelivery: c.codEnabled, delivery: c.deliveryEnabled, pickup: c.pickupEnabled,
      },
    };
  },
};

async function orderByNumber(trx: Trx, number: number): Promise<string | undefined> {
  return (await trx.selectFrom("orders").select("id").where("number", "=", number).executeTakeFirst())?.id;
}

const CHAT_AND_OFFLINE = new Set(["whatsapp", "telegram", "upi", "bank", "cod"]);

export interface Proposal {
  kind: ProposedAction["kind"];
  title: string;
  /** Checked facts for the member to review, label then value. */
  summary: Array<[string, string]>;
  /** What confirming does, in a sentence. */
  effect: string;
  confirmLabel: string;
  danger: boolean;
  /** The existing endpoint the admin calls on confirmation. */
  request: { method: "POST" | "PUT"; path: string; body: Record<string, unknown> };
  /** Where to send the member once it's done (shown as "Open <label>"); `:id` is filled from the response's product or discount. */
  done?: { label: string; path: string; idFrom?: "product" | "discount" };
}

type Checked = { ok: true; proposal: Proposal } | { ok: false; reason: string };

/** The first validation message, as the product or offer form would show it. */
const firstProblem = (issues: ReadonlyArray<{ message: string }>) => `That doesn't pass the store's checks: ${issues[0]?.message ?? "something is missing"}.`;
const toMinor = (major: number) => Math.round(major * 100);

/** Checks a proposed action against the store as it is now; refuses what the endpoint would refuse. */
async function verifyAction(trx: Trx, storeId: string, action: ProposedAction): Promise<Checked> {
  const store = (await storesRepo.getStore(trx))!;
  const money = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: store.currency }).format(minor / 100);
  if (action.kind === "create_product") return verifyNewProduct(storeId, action.product, money);
  if (action.kind === "update_product") return verifyProductChange(trx, storeId, action.productId, action.changes, money);
  if (action.kind === "create_discount") return verifyNewDiscount(storeId, action.discount, money);
  return verifyOrderAction(trx, storeId, action);
}

function verifyNewProduct(storeId: string, p: NewProduct, money: (minor: number) => string): Checked {
  const body = {
    type: "physical",
    status: p.status,
    title: p.title,
    description: p.description,
    tags: p.tags,
    variants: [{ options: [], sku: p.sku, priceMinor: toMinor(p.price), compareAtMinor: p.compareAtPrice === null ? null : toMinor(p.compareAtPrice), stock: p.stock ?? 0 }],
  };
  const checked = ProductBodySchema.safeParse(body);
  if (!checked.success) return { ok: false, reason: firstProblem(checked.error.issues) };
  const summary: Array<[string, string]> = [
    ["Title", p.title],
    ["Price", money(toMinor(p.price))],
    ...(p.compareAtPrice !== null ? ([["Was", money(toMinor(p.compareAtPrice))]] as Array<[string, string]>) : []),
    ["Stock", String(p.stock ?? 0)],
    ["Status", p.status === "active" ? "Active: on sale in your shop" : "Draft: hidden from shoppers"],
    ...(p.sku ? ([["SKU", p.sku]] as Array<[string, string]>) : []),
    ...(p.tags.length ? ([["Tags", p.tags.join(", ")]] as Array<[string, string]>) : []),
    ...(p.description ? ([["Description", p.description.length > 140 ? `${p.description.slice(0, 140)}…` : p.description]] as Array<[string, string]>) : []),
  ];
  return {
    ok: true,
    proposal: {
      kind: "create_product",
      title: `Add product: ${p.title}`,
      summary,
      effect: p.status === "active" ? "Adds it to your catalogue and puts it on sale straight away. You can add photos on its page." : "Adds it to your catalogue as a draft, hidden from shoppers until you make it active. You can add photos on its page.",
      confirmLabel: "Create product",
      danger: false,
      request: { method: "POST", path: `/api/v1/stores/${storeId}/products`, body },
      done: { label: p.title, path: "/products/:id", idFrom: "product" },
    },
  };
}

/** The product as the update endpoint expects it, so unchanged fields stay as they are (stock: null leaves it alone). */
function productBody(p: productsRepo.Product) {
  return {
    type: p.type, status: p.status, title: p.title, handle: p.handle, description: p.description, vendor: p.vendor, tags: p.tags,
    seoTitle: p.seoTitle, seoDescription: p.seoDescription, downloadLimit: p.downloadLimit, downloadExpiryDays: p.downloadExpiryDays,
    bookingDurationMinutes: p.bookingDurationMinutes, bookingNoticeHours: p.bookingNoticeHours, bookingCapacity: p.bookingCapacity, bookingHours: p.bookingHours,
    taxRateBps: p.taxRateBps, options: p.options,
    variants: p.variants.map((v) => ({ id: v.id, options: v.options, sku: v.sku, barcode: v.barcode, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, costMinor: v.costMinor, weightGrams: v.weightGrams, trackInventory: v.trackInventory, allowBackorder: v.allowBackorder, stock: null as number | null })),
    mediaIds: p.mediaIds, fileIds: p.fileIds, collectionIds: p.collectionIds,
  };
}

async function verifyProductChange(trx: Trx, storeId: string, productId: string, c: ProductChanges, money: (minor: number) => string): Promise<Checked> {
  const p = UUID_PATTERN.test(productId) ? await productsRepo.getProduct(trx, productId) : undefined;
  if (!p) return { ok: false, reason: "I couldn't find that product in this store. Search for it first." };
  const body = productBody(p);
  const rows: Array<[string, string]> = [["Product", p.title]];
  const variantChange = c.price !== undefined || c.compareAtPrice !== undefined || c.stock !== undefined;
  if (variantChange && p.variants.length !== 1) return { ok: false, reason: `${p.title} has ${p.variants.length} variants. Change their prices or stock on the product page.` };
  const v = body.variants[0]!;
  if (c.price !== undefined && toMinor(c.price) !== v.priceMinor) {
    rows.push(["Price", `${money(v.priceMinor)} → ${money(toMinor(c.price))}`]);
    v.priceMinor = toMinor(c.price);
  }
  if (c.compareAtPrice !== undefined && (c.compareAtPrice === null ? null : toMinor(c.compareAtPrice)) !== v.compareAtMinor) {
    rows.push(["Was price", `${v.compareAtMinor === null ? "none" : money(v.compareAtMinor)} → ${c.compareAtPrice === null ? "none" : money(toMinor(c.compareAtPrice))}`]);
    v.compareAtMinor = c.compareAtPrice === null ? null : toMinor(c.compareAtPrice);
  }
  if (c.stock !== undefined && c.stock !== p.variants[0]!.onHand) {
    const variant = p.variants[0]!;
    if (!variant.trackInventory) return { ok: false, reason: `${p.title} doesn't track stock. Turn on stock tracking on the product page first.` };
    rows.push(["Stock on hand", `${variant.onHand} → ${c.stock}`]);
    v.stock = c.stock;
  }
  if (c.status !== undefined && c.status !== p.status) {
    rows.push(["Status", `${p.status} → ${c.status}`]);
    body.status = c.status;
  }
  if (c.title !== undefined && c.title !== p.title) {
    rows.push(["Title", `${p.title} → ${c.title}`]);
    body.title = c.title;
  }
  if (c.description !== undefined && c.description !== p.description) {
    rows.push(["Description", c.description ? (c.description.length > 120 ? `${c.description.slice(0, 120)}…` : c.description) : "(removed)"]);
    body.description = c.description;
  }
  if (c.addTags?.length) {
    const added = c.addTags.map((t) => t.toLowerCase()).filter((t) => !p.tags.includes(t));
    if (added.length) {
      rows.push(["Add tags", added.join(", ")]);
      body.tags = [...p.tags, ...added];
    }
  }
  if (rows.length === 1) return { ok: false, reason: `${p.title} already looks like that: there's nothing to change.` };
  const checked = ProductBodySchema.safeParse(body);
  if (!checked.success) return { ok: false, reason: firstProblem(checked.error.issues) };
  return {
    ok: true,
    proposal: {
      kind: "update_product",
      title: `Update ${p.title}`,
      summary: rows,
      effect: c.status === "archived" ? "Saves these changes. Archived products disappear from your shop." : "Saves these changes. Everything else about the product stays as it is.",
      confirmLabel: "Save changes",
      danger: c.status === "archived",
      request: { method: "PUT", path: `/api/v1/stores/${storeId}/products/${p.id}`, body },
      done: { label: body.title, path: `/products/${p.id}` },
    },
  };
}

function verifyNewDiscount(storeId: string, d: NewDiscount, money: (minor: number) => string): Checked {
  const off = d.type === "percentage" ? `${d.value}% off` : d.type === "fixed" ? `${money(toMinor(d.value))} off` : "Free shipping";
  const body = {
    method: d.code ? "code" : "automatic",
    code: d.code,
    title: d.title ?? (d.code ? `${d.code}: ${off}` : off),
    type: d.type,
    value: d.type === "percentage" ? Math.round(d.value * 100) : d.type === "fixed" ? toMinor(d.value) : 0,
    minSubtotalMinor: d.minSpend === null ? null : toMinor(d.minSpend),
    endsAt: d.endsOn ? `${d.endsOn}T23:59:59.000Z` : null,
    usageLimit: d.usageLimit,
    oncePerCustomer: d.oncePerCustomer,
  };
  const checked = DiscountBodySchema.safeParse(body);
  if (!checked.success) return { ok: false, reason: firstProblem(checked.error.issues) };
  const summary: Array<[string, string]> = [
    ["How", d.code ? `Code ${checked.data.code}, typed at checkout` : "Automatic, for every eligible cart"],
    ["Discount", off],
    ["Minimum spend", d.minSpend === null ? "None" : money(toMinor(d.minSpend))],
    ["Ends", d.endsOn ?? "No end date"],
    ...(d.usageLimit ? ([["Usage limit", `${d.usageLimit} uses`]] as Array<[string, string]>) : []),
    ...(d.oncePerCustomer ? ([["Once per customer", "Yes"]] as Array<[string, string]>) : []),
  ];
  return {
    ok: true,
    proposal: {
      kind: "create_discount",
      title: d.code ? `Create code ${checked.data.code}` : `Create offer: ${off}`,
      summary,
      effect: "Starts working straight away for the whole store. You can pause or edit it under Offers.",
      confirmLabel: "Create offer",
      danger: false,
      request: { method: "POST", path: `/api/v1/stores/${storeId}/discounts`, body },
      done: { label: "Offers", path: "/offers" },
    },
  };
}

async function verifyOrderAction(trx: Trx, storeId: string, action: Extract<ProposedAction, { orderNumber: number }>): Promise<Checked> {
  const id = await orderByNumber(trx, action.orderNumber);
  if (!id) return { ok: false, reason: `There's no order #${action.orderNumber} in this store.` };
  const { order: o, items } = (await ordersRepo.getOrder(trx, id))!;
  const money = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: o.currency }).format(minor / 100);
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const summary: Array<[string, string]> = [
    ["Order", `#${o.number}`],
    ["Customer", o.name],
    ["Total", money(o.totalMinor)],
    ["Payment", `${o.paymentStatus} · ${o.paymentMethod}`],
    ["Fulfilment", `${o.fulfillmentStatus} · ${units} item${units === 1 ? "" : "s"}`],
  ];
  const path = `/api/v1/stores/${storeId}/orders/${id}`;
  if (o.status !== "open") return { ok: false, reason: `Order #${o.number} is already cancelled.` };
  if (action.kind === "mark_order_paid") {
    if (o.paymentStatus !== "pending") return { ok: false, reason: `Order #${o.number} isn't awaiting payment (it's ${o.paymentStatus}).` };
    if (!CHAT_AND_OFFLINE.has(o.paymentMethod)) return { ok: false, reason: `Order #${o.number} is a card order: it's marked paid only when the gateway confirms the payment.` };
    return { ok: true, proposal: { kind: action.kind, title: `Mark order #${o.number} as paid`, summary, effect: `Records ${money(o.totalMinor)} received by ${o.paymentMethod} in your finances and unlocks any downloads.`, confirmLabel: "Mark as paid", danger: false, request: { method: "POST", path: `${path}/paid`, body: {} } } };
  }
  if (action.kind === "mark_order_fulfilled") {
    if (o.fulfillmentStatus === "fulfilled") return { ok: false, reason: `Order #${o.number} is already fulfilled.` };
    return { ok: true, proposal: { kind: action.kind, title: `Mark order #${o.number} as fulfilled`, summary, effect: "Marks every remaining item as fulfilled, without tracking details. To add tracking, use the order page instead.", confirmLabel: "Mark as fulfilled", danger: false, request: { method: "POST", path: `${path}/fulfilled`, body: {} } } };
  }
  if (o.paymentStatus === "paid" && !CHAT_AND_OFFLINE.has(o.paymentMethod)) return { ok: false, reason: `Order #${o.number} was paid by card. Refund it from the order page first.` };
  return {
    ok: true,
    proposal: {
      kind: action.kind,
      title: `Cancel order #${o.number}`,
      summary: [...summary, ["Restock", action.restock ? "Yes, return items to stock" : "No"]],
      effect: `Cancels the order${action.restock ? " and returns its items to stock" : ""}. This can't be undone.`,
      confirmLabel: "Cancel order",
      danger: true,
      request: { method: "POST", path: `${path}/cancel`, body: { restock: action.restock } },
    },
  };
}

/** Resolves a navigation request to an admin link the member can open, or nothing. */
async function resolveLink(trx: Trx, storeId: string, nav: Navigation, perms: ReadonlySet<string>): Promise<{ label: string; href: string } | null> {
  const base = `/s/${storeId}`;
  if ("page" in nav) {
    const page = assistantCapabilities(perms).pages.find((p) => p.key === nav.page);
    return page ? { label: page.label, href: `${base}${page.path}` } : null;
  }
  if ("order" in nav) {
    if (!perms.has("orders.read")) return null;
    const id = await orderByNumber(trx, nav.order);
    return id ? { label: `Order #${nav.order}`, href: `${base}/orders/${id}` } : null;
  }
  if (!perms.has("products.read") || !UUID_PATTERN.test(nav.product)) return null;
  const p = await productsRepo.getProduct(trx, nav.product);
  return p ? { label: p.title, href: `${base}/products/${p.id}` } : null;
}

export function assistantRoutes(router: Router, deps: AppDependencies, access: StoreAccess): void {
  const limit = deps.settings.assistantDailyLimit ?? 200;
  const provider = deps.assistant;

  /** Runs `fn` as the member, with their current permissions; undefined when they're no longer an active member. */
  const asMember = async <T>(res: Response, storeId: string, fn: (trx: Trx, perms: ReadonlySet<StorePermission>, name: string) => Promise<T>): Promise<T | undefined> => {
    const userId = sessionOf(res).userId;
    const out = await access.inStore(storeId, userId, async (trx, membership) => ({ kind: "ok", body: await fn(trx, storePermissions(membership), membership.role) }));
    return out === NOT_VISIBLE || out.kind !== "ok" ? undefined : out.body;
  };

  router.get("/stores/:storeId/assistant", async (req, res) => {
    respond(
      res,
      await access.inStore(req.params.storeId, sessionOf(res).userId, async (trx) => ({ kind: "ok", body: { enabled: Boolean(provider), usedToday: await aiRepo.assistantUsedToday(trx), dailyLimit: limit } })),
    );
  });

  router.post("/stores/:storeId/assistant", async (req, res) => {
    const body = AskBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    if (!provider) return sendProblem(res, 503, "AI_DISABLED", "The assistant isn't set up on this server");
    const storeId = req.params.storeId;
    const userId = sessionOf(res).userId;

    // 1. The member, their store and role, and one question from today's allowance.
    const start = await access.inStore(storeId, userId, async (trx, membership) => {
      const taken = await aiRepo.takeAssistantMessage(trx, storeId, limit);
      if (taken.kind === "limit") return { kind: "conflict", code: "ASSISTANT_DAILY_LIMIT", title: `This store has used today's ${taken.limit} assistant questions. More are available tomorrow` };
      const store = (await storesRepo.getStore(trx))!;
      return { kind: "ok", body: { store, role: membership.role, perms: storePermissions(membership), used: taken.used } };
    });
    if (start === NOT_VISIBLE || start.kind !== "ok") return respond(res, start);
    const { store, role, perms, used } = start.body;
    const name = (await identityRepo.getUserProfile(deps.db, userId))?.displayName ?? "Team member";

    // 2. The model, with tools that run as the member, inside this store only.
    const history: AssistantMessage[] = body.data.history.slice(-HISTORY_SENT);
    while (history[0]?.role === "assistant") history.shift();
    const system = assistantSystem({ storeName: store.name, role, memberName: name, currency: store.currency, timeZone: store.timezone, today: analyticsRepo.today(store.timezone), permissions: perms });
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const turn = await runAssistantTurn(
      provider,
      { system, history, question: body.data.question },
      async (tool, args) => {
        const spec = ASSISTANT_TOOLS.find((t) => t.name === tool);
        const run = TOOLS[tool];
        if (!spec || !run) return { ok: false, error: `There's no tool called ${tool}` };
        const result = await asMember(res, storeId, (trx, current) => {
          // Checked again per call: a role can change while a question runs.
          if (spec.permission && !spec.permission.some((p) => current.has(p as StorePermission))) return Promise.resolve<ToolResult>({ ok: false, error: "This member's role doesn't allow that" });
          return run(trx, args, { storeId, storefrontOrigin: deps.settings.storefrontOrigin, perms: current });
        });
        return result ?? { ok: false, error: "This member no longer has access to the store" };
      },
      abort.signal,
    );

    // 3. Links and proposals are resolved against the store as it is now.
    const finished = await asMember(res, storeId, async (trx, current) => {
      await aiRepo.addAssistantTokens(trx, turn.usage.inputTokens + turn.usage.outputTokens);
      if (!turn.ok) return undefined;
      const link = turn.answer.navigate ? await resolveLink(trx, storeId, turn.answer.navigate, current) : null;
      let proposal: Proposal | null = null;
      let note: string | null = null;
      const action = turn.answer.action;
      if (action) {
        const needs = ASSISTANT_ACTIONS.find((a) => a.kind === action.kind)?.permission ?? [];
        if (!needs.some((p) => current.has(p as StorePermission))) note = "Your role can't make this change. Ask a store owner or admin.";
        else {
          const checked = await verifyAction(trx, storeId, action);
          if (checked.ok) proposal = checked.proposal;
          else note = checked.reason;
        }
      }
      return { text: turn.answer.text, link, proposal, note };
    });
    deps.logger.info({ storeId, tools: turn.tools, ok: turn.ok, code: turn.ok ? undefined : turn.code, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens }, "assistant turn");
    if (!turn.ok) {
      const busy = turn.code === "provider_rate_limited" || turn.code === "provider_unavailable" || turn.code === "provider_timeout";
      return sendProblem(res, busy ? 503 : 502, "ASSISTANT_FAILED", busy ? "The assistant is busy right now. Try again in a moment" : "The assistant couldn't answer that. Try asking another way");
    }
    if (!finished) return problems.notFound(res);
    res.json({ answer: finished, usedToday: used, dailyLimit: limit });
  });
}
