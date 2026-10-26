import { Router, type Request, type Response } from "express";
import type { Transaction } from "kysely";
import { chatOrderMessage, deliveryOptions, isDate, localParts, slotsOn, telegramLink, whatsappLink, type DeliveryMethod, type PricingLine } from "@workeasy/commerce";
import {
  analyticsRepo,
  checkoutRepo,
  designRepo,
  mediaRepo,
  moneyRepo,
  ordersRepo,
  pagesRepo,
  reviewsRepo,
  rulesRepo,
  storefrontRepo,
  storesRepo,
  withStore,
  type CheckoutSettings,
  type Database,
  type Fulfillment,
  type GatewayProvider,
  type Order,
  type OrderItem,
  type PublicStore,
} from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { GatewayError, verifyRazorpayPayment } from "@workeasy/payments";
import { EventsBodySchema, ReviewBodySchema } from "../contract/engagement.js";
import { CheckoutCaptureBodySchema, RazorpayConfirmBodySchema } from "../contract/money.js";
import { CartBodySchema, PlaceOrderBodySchema } from "../contract/orders.js";
import type { PublicStoreResponse } from "../contract/schemas.js";
import { problems, sendProblem } from "../http/problem.js";
import { requestIdOf, requestLog } from "../http/request-context.js";
import { deviceClass, isBot, trafficSource } from "../http/visit.js";
import { verifyPreviewToken } from "./studio.js";
import { credentialsFor, refreshStripePayment, startPayment, type PaymentStart } from "../payments/gateways.js";
import { createAttemptLimiter } from "../identity/passwords.js";
import { issuesToErrors } from "./support.js";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const HANDLE_PATTERN = /^[a-z0-9-]{1,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Signed media URLs work for an hour; the redirect to one is cached for five minutes. */
const MEDIA_URL_SECONDS = 60 * 60;
const MEDIA_CACHE_SECONDS = 5 * 60;
const PAGE_SIZE = 24;
/** Orders one visitor may place in one shop in ten minutes; stops scripted floods of fake orders. */
const MAX_ORDERS_PER_WINDOW = 10;
/** Checkout saves one visitor may make in ten minutes (the form saves as the shopper types their details). */
const MAX_CHECKOUT_SAVES_PER_WINDOW = 30;
/** Payment starts and confirmations one visitor may make in ten minutes. */
const MAX_PAYMENT_CALLS_PER_WINDOW = 30;
/** Analytics batches one visitor may send in ten minutes. */
const MAX_EVENT_BATCHES_PER_WINDOW = 300;
/** Reviews one visitor may submit in ten minutes. */
const MAX_REVIEWS_PER_WINDOW = 20;
const REVIEWS_PAGE_SIZE = 10;

type Trx = Transaction<Database>;

/** What a shopper sees about how to pay and receive orders; never internal fields. `card` is the connected gateway, if any. */
function checkoutJson(s: CheckoutSettings, card: GatewayProvider | undefined) {
  return {
    paymentMethods: [...(card ? (["card"] as const) : []), ...checkoutRepo.enabledPaymentMethods(s)],
    card: card ? { provider: card } : null,
    delivery: { enabled: s.deliveryEnabled, feeMinor: s.deliveryFeeMinor, freeOverMinor: s.freeDeliveryOverMinor },
    pickup: s.pickupEnabled ? { address: s.pickupAddress } : null,
    orderNoteEnabled: s.orderNoteEnabled,
  };
}

function deliverySettings(s: CheckoutSettings) {
  return { deliveryEnabled: s.deliveryEnabled, deliveryFeeMinor: s.deliveryFeeMinor, freeDeliveryOverMinor: s.freeDeliveryOverMinor, pickupEnabled: s.pickupEnabled };
}

function bookingLabel(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(at);
}

/**
 * Storefront routes, served to anyone. Reads run as the public database role
 * in the shop's store context, where row security shows only what is on
 * sale. Placing an order runs as the API role in that same context; the
 * store always comes from the shop's address, never from the request body.
 */
export function publicV1Router({ db, publicDb, objectStore, payments, logger, settings: appSettings }: AppDependencies): Router {
  const router = Router();
  const orderLimiter = createAttemptLimiter(MAX_ORDERS_PER_WINDOW, 10 * 60 * 1000);
  const checkoutLimiter = createAttemptLimiter(MAX_CHECKOUT_SAVES_PER_WINDOW, 10 * 60 * 1000);
  const paymentLimiter = createAttemptLimiter(MAX_PAYMENT_CALLS_PER_WINDOW, 10 * 60 * 1000);
  const eventLimiter = createAttemptLimiter(MAX_EVENT_BATCHES_PER_WINDOW, 10 * 60 * 1000);
  const reviewLimiter = createAttemptLimiter(MAX_REVIEWS_PER_WINDOW, 10 * 60 * 1000);
  const ownHosts = [new URL(appSettings.storefrontOrigin).hostname.replace(/^www\./, "")];

  /** A review from a buyer whose order was found by its order link or review link. */
  async function postReview(req: Request, res: Response, store: PublicStore, orderId: string): Promise<void> {
    const body = ReviewBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    const visitor = `${req.ip ?? "unknown"}:${store.id}`;
    if (reviewLimiter.blocked(visitor)) return sendProblem(res, 429, "TOO_MANY_REVIEWS", "Too many reviews in a short time. Please wait a few minutes");
    reviewLimiter.fail(visitor);
    const result = await withStore(db, store.id, (trx) => reviewsRepo.submitReview(trx, { storeId: store.id, orderId, ...body.data }));
    if (result.kind === "not_allowed") return sendProblem(res, 409, "CANNOT_REVIEW", "You can review items once your order is paid or on its way");
    if (result.kind === "already") return sendProblem(res, 409, "ALREADY_REVIEWED", "You've already reviewed this item");
    res.status(201).json({ status: result.status, items: await withStore(db, store.id, (trx) => reviewsRepo.reviewableItems(trx, orderId)) });
  }
  const payCtx = (store: PublicStore) => ({ db, payments, store: { id: store.id, slug: store.slug, name: store.name }, storefrontOrigin: appSettings.storefrontOrigin });

  /** The card gateway shoppers can pay through. Gateway accounts aren't visible to the public role, so this reads as the API. */
  const cardFor = (store: PublicStore) => withStore(db, store.id, (trx) => moneyRepo.cardGateway(trx, store.currency));

  /** Starts a card payment, turning gateway trouble into "try again" for the shopper. */
  async function beginPayment(res: Response, store: PublicStore, order: Order, token: string): Promise<PaymentStart | { paid: true } | { error: string }> {
    try {
      const started = await startPayment(payCtx(store), order, token);
      if ("unavailable" in started) return { error: "Card payments aren't available in this shop right now" };
      return started;
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      requestLog(res, logger).warn({ code: err.code, storeId: store.id }, "couldn't start card payment");
      return { error: "The payment page couldn't be opened. Please try again in a moment" };
    }
  }

  async function shopOf(res: Response, slug: string): Promise<PublicStore | undefined> {
    const store = SLUG_PATTERN.test(slug) ? await storesRepo.resolvePublicStore(publicDb, slug) : undefined;
    if (!store) {
      res.set("Cache-Control", "no-store");
      problems.notFound(res);
      return undefined;
    }
    return store;
  }

  const read = <T>(storeId: string, fn: (trx: Trx) => Promise<T>) => withStore(publicDb, storeId, fn);

  router.get("/stores/:slug", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const { settings, collections, theme } = await read(store.id, async (trx) => ({
      settings: await checkoutRepo.getCheckoutSettings(trx),
      collections: await storefrontRepo.navCollections(trx),
      theme: await designRepo.publishedTheme(trx, store.defaultLocale),
    }));
    // Store Design's preview shows the draft to whoever holds a signed preview link.
    const preview = typeof req.query.preview === "string" && verifyPreviewToken(appSettings.sessionSecret, store.id, req.query.preview);
    const shown = preview ? (await withStore(db, store.id, (trx) => designRepo.getThemeState(trx, store.defaultLocale))).draft : theme;
    const body: PublicStoreResponse & Record<string, unknown> = {
      store: { slug: store.slug, name: store.name, currency: store.currency, country: store.country, defaultLocale: store.defaultLocale },
      checkout: checkoutJson(settings, await cardFor(store)),
      collections: collections.map(({ id: _id, ...c }) => c),
      theme: shown,
      preview,
    };
    // Shop details change rarely; a short shared cache keeps the storefront fast. Previews are never cached.
    res.set("Cache-Control", preview ? "no-store" : "public, max-age=30");
    res.json(body);
  });

  router.get("/stores/:slug/products", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const sort = (["newest", "price_asc", "price_desc", "title"] as const).find((s) => s === req.query.sort) ?? "newest";
    const page = Math.max(1, Math.min(200, Number(req.query.page) || 1));
    const result = await read(store.id, async (trx) => {
      const found = await storefrontRepo.searchProductIds(trx, { q: q || undefined, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      return { products: await storefrontRepo.productCards(trx, found.ids), total: found.total };
    });
    res.set("Cache-Control", "public, max-age=15");
    res.json({ ...result, page, pageSize: PAGE_SIZE });
  });

  router.get("/stores/:slug/products/:handle", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const product = HANDLE_PATTERN.test(req.params.handle) ? await read(store.id, (trx) => storefrontRepo.productByHandle(trx, req.params.handle)) : undefined;
    if (!product) {
      problems.notFound(res);
      return;
    }
    res.set("Cache-Control", "public, max-age=15");
    res.json({ product });
  });

  /** A published content page (About us, policies). */
  router.get("/stores/:slug/pages/:handle", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const page = HANDLE_PATTERN.test(req.params.handle) ? await read(store.id, (trx) => pagesRepo.publishedPage(trx, req.params.handle)) : undefined;
    if (!page) {
      problems.notFound(res);
      return;
    }
    res.set("Cache-Control", "public, max-age=15");
    res.json({ page: { ...page, updatedAt: page.updatedAt.toISOString() } });
  });

  router.get("/stores/:slug/collections/:handle", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const sort = (["newest", "price_asc", "price_desc", "title"] as const).find((s) => s === req.query.sort);
    const found = HANDLE_PATTERN.test(req.params.handle)
      ? await read(store.id, async (trx) => {
          const c = await storefrontRepo.collectionByHandle(trx, req.params.handle, sort);
          return c ? { collection: c.collection, products: await storefrontRepo.productCards(trx, c.productIds) } : undefined;
        })
      : undefined;
    if (!found) {
      problems.notFound(res);
      return;
    }
    const { id: _id, ...collection } = found.collection;
    res.set("Cache-Control", "public, max-age=15");
    res.json({ collection, products: found.products });
  });

  /**
   * Prices a cart with current catalog data: each line's price and stock,
   * which lines can't be bought, the delivery choices and the totals.
   */
  router.post("/stores/:slug/cart", async (req, res) => {
    const body = CartBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const { variants, settings } = await read(store.id, async (trx) => ({
      variants: await storefrontRepo.cartVariants(trx, body.data.items.map((i) => i.variantId)),
      settings: await checkoutRepo.getCheckoutSettings(trx),
    }));
    const lines = body.data.items.map((item) => {
      const v = variants.get(item.variantId);
      if (!v) return { variantId: item.variantId, quantity: item.quantity, problem: "This item is no longer available" };
      const problem = !v.available ? "Out of stock" : v.maxQuantity !== null && item.quantity > v.maxQuantity ? `Only ${v.maxQuantity} left` : undefined;
      return { ...v, quantity: item.quantity, bookingAt: item.bookingAt ?? null, totalMinor: v.priceMinor * item.quantity, ...(problem ? { problem } : {}) };
    });
    const priced: PricingLine[] = lines
      .filter((l): l is Extract<typeof l, { priceMinor: number }> => "priceMinor" in l)
      .map((l) => ({ productId: l.productId, productType: l.type, unitPriceMinor: l.priceMinor, quantity: l.quantity, weightGrams: l.weightGrams, taxRateBps: l.taxRateBps }));
    const options = deliveryOptions(priced, deliverySettings(settings));
    const b = body.data;
    const method = b.deliveryMethod && options.includes(b.deliveryMethod) ? b.deliveryMethod : options[0];
    // Discounts, zones and tax settings aren't readable by the public role, so pricing reads as the API.
    const { quotes, chosen, zoned, tax } = await withStore(db, store.id, async (trx) => {
      const price = (m: DeliveryMethod, full: boolean) =>
        ordersRepo.priceCart(trx, {
          lines: priced,
          deliveryMethod: m,
          address: m === "delivery" && b.address ? { country: b.address.country, state: b.address.state ?? null, postalCode: b.address.postalCode ?? null } : null,
          rateId: full ? b.rateId : null,
          discountCode: b.discountCode,
          email: b.email,
          currency: store.currency,
        });
      const all = await Promise.all(options.map(async (m) => [m, (await price(m, false)).priced] as const));
      return {
        quotes: Object.fromEntries(all.map(([m, p]) => [m, { subtotalMinor: p.subtotalMinor, discountMinor: p.discountMinor, deliveryMinor: p.deliveryMinor, taxMinor: p.taxMinor, totalMinor: p.totalMinor }])),
        chosen: method ? await price(method, true) : undefined,
        zoned: (await rulesRepo.listZones(trx)).length > 0,
        tax: await rulesRepo.getTaxSettings(trx),
      };
    });
    const p = chosen?.priced;
    res.set("Cache-Control", "no-store");
    res.json({
      lines,
      deliveryOptions: options,
      totals: quotes,
      pricing: p
        ? {
            deliveryMethod: method,
            subtotalMinor: p.subtotalMinor,
            discountMinor: p.discountMinor,
            discount: p.discount && { code: p.discount.code, title: p.discount.title, type: p.discount.type, amountMinor: p.discount.amountMinor },
            discountError: chosen.discountError,
            deliveryMinor: p.deliveryMinor,
            shippingOptions: p.shippingOptions,
            shippingRateId: p.shippingRate?.id ?? null,
            // Zone-based shipping needs the address before it can be priced.
            shippingNeedsAddress: method === "delivery" && zoned && !b.address,
            deliverable: p.deliverable,
            codAllowed: p.codAllowed,
            taxMinor: p.taxMinor,
            taxLabel: tax.enabled ? tax.label : null,
            pricesIncludeTax: p.pricesIncludeTax,
            totalMinor: p.totalMinor,
          }
        : null,
      checkout: checkoutJson(settings, await cardFor(store)),
      currency: store.currency,
    });
  });

  router.post("/stores/:slug/orders", async (req, res) => {
    const body = PlaceOrderBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const visitor = `${req.ip ?? "unknown"}:${store.id}`;
    if (orderLimiter.blocked(visitor)) {
      sendProblem(res, 429, "TOO_MANY_ORDERS", "Too many orders in a short time. Please wait a few minutes");
      return;
    }
    const o = body.data;
    const cardEnabled = o.paymentMethod === "card" && (await cardFor(store)) !== undefined;
    const result = await withStore(db, store.id, (trx) =>
      ordersRepo.placeOrder(trx, {
        storeId: store.id,
        items: o.items,
        email: o.email,
        name: o.name,
        phone: o.phone,
        deliveryMethod: o.deliveryMethod,
        address: o.address ? { ...o.address, line2: o.address.line2, state: o.address.state, country: o.address.country ?? store.country } : null,
        paymentMethod: o.paymentMethod,
        note: o.note,
        cardEnabled,
        checkoutId: o.checkoutId,
        discountCode: o.discountCode,
        rateId: o.rateId,
        traceId: requestIdOf(res),
      }),
    );
    res.set("Cache-Control", "no-store");
    if (result.kind === "problems") {
      res.status(409).type("application/problem+json").json({
        type: "urn:workeasy:error:order_not_placed",
        title: result.problems[0]?.message ?? "The order couldn't be placed",
        status: 409,
        code: "ORDER_NOT_PLACED",
        requestId: requestIdOf(res) ?? "unknown",
        problems: result.problems,
      });
      return;
    }
    orderLimiter.fail(visitor);
    let payment: PaymentStart | { paid: true } | { error: string } | null = null;
    if (o.paymentMethod === "card") {
      const placed = (await withStore(db, store.id, (trx) => ordersRepo.getOrderWithItems(trx, result.orderId)))!.order;
      payment = await beginPayment(res, store, placed, result.token);
    }
    res.status(201).json({ order: { number: result.number, token: result.token }, payment });
  });

  /** Card orders awaiting payment: open (or reopen) the payment. */
  router.post("/stores/:slug/orders/:token/pay", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const visitor = `${req.ip ?? "unknown"}:${store.id}`;
    if (paymentLimiter.blocked(visitor)) {
      sendProblem(res, 429, "TOO_MANY_ATTEMPTS", "Too many attempts. Please wait a few minutes");
      return;
    }
    paymentLimiter.fail(visitor);
    const found = await withStore(db, store.id, (trx) => ordersRepo.orderByToken(trx, req.params.token));
    if (!found) {
      problems.notFound(res);
      return;
    }
    const { order } = found;
    if (order.paymentMethod !== "card" || order.status !== "open" || order.paymentStatus !== "pending") {
      sendProblem(res, 409, "NOTHING_TO_PAY", order.status === "cancelled" ? "This order was cancelled" : "This order doesn't need paying online");
      return;
    }
    res.json({ payment: await beginPayment(res, store, order, req.params.token) });
  });

  /**
   * Razorpay Checkout's success callback. The signature proves Razorpay took
   * this payment for our Razorpay order; the webhook confirms it again.
   */
  router.post("/stores/:slug/orders/:token/payments/razorpay", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const body = RazorpayConfirmBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const visitor = `${req.ip ?? "unknown"}:${store.id}`;
    if (paymentLimiter.blocked(visitor)) {
      sendProblem(res, 429, "TOO_MANY_ATTEMPTS", "Too many attempts. Please wait a few minutes");
      return;
    }
    const b = body.data;
    const result = await withStore(db, store.id, async (trx) => {
      const found = await ordersRepo.orderByToken(trx, req.params.token);
      if (!found) return "not_found" as const;
      const payment = await moneyRepo.paymentByRef(trx, "razorpay", b.razorpayOrderId);
      if (!payment || payment.orderId !== found.order.id) return "not_found" as const;
      const creds = await credentialsFor(trx, payments, "razorpay");
      if (!creds || !verifyRazorpayPayment(creds, { razorpayOrderId: b.razorpayOrderId, paymentId: b.paymentId, signature: b.signature })) return "bad_signature" as const;
      // A Razorpay order is paid in full or not at all, so its amount is what was paid.
      return moneyRepo.confirmGatewayPayment(trx, { storeId: store.id, paymentId: payment.id, providerPaymentId: b.paymentId, amountMinor: payment.amountMinor, method: null });
    });
    if (result === "not_found") {
      problems.notFound(res);
      return;
    }
    if (result === "bad_signature") {
      paymentLimiter.fail(visitor);
      sendProblem(res, 400, "BAD_SIGNATURE", "We couldn't verify this payment");
      return;
    }
    if (result === "order_closed") {
      // Paid after the order was cancelled for running out of time: the merchant refunds it.
      requestLog(res, logger).warn({ storeId: store.id }, "razorpay payment for a closed order");
    }
    res.json({ status: result === "paid" || result === "already" ? "paid" : result });
  });

  /**
   * Saves a shopper's details and cart as they reach checkout, so the
   * merchant can see checkouts that didn't become orders.
   */
  router.post("/stores/:slug/checkouts", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const body = CheckoutCaptureBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const visitor = `${req.ip ?? "unknown"}:${store.id}`;
    if (checkoutLimiter.blocked(visitor)) {
      sendProblem(res, 429, "TOO_MANY_ATTEMPTS", "Too many requests. Please wait a few minutes");
      return;
    }
    checkoutLimiter.fail(visitor);
    const c = body.data;
    const variants = await read(store.id, (trx) => storefrontRepo.cartVariants(trx, c.items.map((i) => i.variantId)));
    const items = c.items.flatMap((i) => {
      const v = variants.get(i.variantId);
      return v ? [{ variantId: v.variantId, handle: v.handle, title: v.title, variantTitle: v.variantTitle, quantity: i.quantity, priceMinor: v.priceMinor }] : [];
    });
    if (items.length === 0) {
      res.status(204).end();
      return;
    }
    const checkoutId = await withStore(db, store.id, (trx) =>
      moneyRepo.saveCheckout(trx, {
        id: c.checkoutId,
        storeId: store.id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        items,
        subtotalMinor: items.reduce((n, i) => n + i.priceMinor * i.quantity, 0),
        currency: store.currency,
      }),
    );
    res.json({ checkoutId });
  });

  /** The shopper's order page: status, items, how to pay, and the chat link for chat orders. */
  router.get("/stores/:slug/orders/:token", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const load = () =>
      withStore(db, store.id, async (trx) => {
        const o = await ordersRepo.orderByToken(trx, req.params.token);
        if (!o) return undefined;
        const s = await storesRepo.getStore(trx);
        return {
          ...o,
          fulfillments: await ordersRepo.listFulfillments(trx, o.order.id),
          downloads: await rulesRepo.orderDownloads(trx, o.order.id),
          reviews: await reviewsRepo.reviewableItems(trx, o.order.id),
          settings: await checkoutRepo.getCheckoutSettings(trx),
          timezone: s?.timezone ?? "Asia/Kolkata",
          contactEmail: s?.contactEmail ?? null,
        };
      });
    let found = await load();
    // Back from Stripe: check the session now rather than wait for the webhook.
    if (found && req.query.paid === "stripe" && found.order.paymentMethod === "card" && found.order.paymentStatus === "pending") {
      await refreshStripePayment({ db, payments }, store.id, found.order.id);
      found = await load();
    }
    if (!found) {
      problems.notFound(res);
      return;
    }
    const orderUrl = new URL(`/s/${store.slug}/order/${req.params.token}`, appSettings.storefrontOrigin).toString();
    res.json({
      order: {
        ...shopperOrder(found.order, found.items, found.settings, store, found.timezone, orderUrl, found.fulfillments),
        downloads: found.downloads.map((d) => ({
          id: d.id,
          orderItemId: d.orderItemId,
          fileName: d.fileName,
          downloadsLeft: d.downloadLimit === null ? null : Math.max(0, d.downloadLimit - d.downloadsUsed),
          expiresAt: d.expiresAt?.toISOString() ?? null,
          usable: d.usable,
          url: `/public/v1/stores/${store.slug}/orders/${req.params.token}/downloads/${d.id}`,
        })),
      },
      contactEmail: found.contactEmail,
      reviews: found.reviews === "not_yet" ? null : found.reviews,
    });
  });

  /**
   * Which shop a custom domain serves, for the storefront's routing. Also the
   * TLS check: the front proxy asks /domains/check?domain= before issuing a
   * certificate, and only verified domains get one.
   */
  router.get("/domains/check", async (req, res) => {
    const host = typeof req.query.domain === "string" ? req.query.domain.toLowerCase().slice(0, 253) : "";
    const slug = host ? await storesRepo.resolveDomain(publicDb, host) : undefined;
    res.set("Cache-Control", "no-store");
    res.status(slug ? 200 : 404).end();
  });

  router.get("/domains/:host", async (req, res) => {
    const slug = await storesRepo.resolveDomain(publicDb, req.params.host.slice(0, 253));
    if (!slug) {
      res.set("Cache-Control", "public, max-age=30");
      return problems.notFound(res);
    }
    res.set("Cache-Control", "public, max-age=60");
    res.json({ slug });
  });

  /**
   * Open slots for a bookable service. Without a date: the next 30 days that
   * have opening hours. With `date=YYYY-MM-DD`: each slot that day and the
   * places left, in the store's time zone.
   */
  router.get("/stores/:slug/products/:handle/slots", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const product = HANDLE_PATTERN.test(req.params.handle) ? await read(store.id, (trx) => storefrontRepo.productByHandle(trx, req.params.handle)) : undefined;
    if (!product || product.type !== "service") {
      problems.notFound(res);
      return;
    }
    const now = new Date();
    const found = await withStore(db, store.id, async (trx) => {
      const p = await trx.selectFrom("products").select(["booking_hours", "booking_capacity"]).where("id", "=", product.id).executeTakeFirst();
      const s = await storesRepo.getStore(trx);
      return p && s ? { hours: rulesRepo.bookingHoursOf(p.booking_hours), capacity: p.booking_capacity ?? 1, timeZone: s.timezone } : undefined;
    });
    if (!found) {
      problems.notFound(res);
      return;
    }
    const rules = { hours: found.hours, durationMinutes: product.bookingDurationMinutes ?? 60, noticeHours: product.bookingNoticeHours ?? 0, timeZone: found.timeZone, horizonDays: 90 };
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    if (!date) {
      const today = localParts(now, found.timeZone).date;
      const days: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.parse(`${today}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        if (slotsOn(d, rules, now).length > 0) days.push(d);
      }
      res.json({ timeZone: found.timeZone, durationMinutes: rules.durationMinutes, days });
      return;
    }
    if (!isDate(date)) {
      problems.validation(res, [{ field: "date", code: "INVALID", message: "Use a date like 2026-11-02" }]);
      return;
    }
    const slots = slotsOn(date, rules, now);
    const taken = slots.length
      ? await withStore(db, store.id, (trx) => rulesRepo.bookedCounts(trx, product.id, slots[0]!, new Date(slots.at(-1)!.getTime() + 1)))
      : new Map<number, number>();
    res.json({
      timeZone: found.timeZone,
      durationMinutes: rules.durationMinutes,
      date,
      slots: slots.map((s) => ({ at: s.toISOString(), time: localParts(s, found.timeZone).time, left: Math.max(0, found.capacity - (taken.get(s.getTime()) ?? 0)) })),
    });
  });

  /**
   * Anonymous visit events from the storefront. Answers 202 whatever happens,
   * so blocking or failing to track never breaks a page.
   */
  router.post("/stores/:slug/events", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const body = EventsBodySchema.safeParse(req.body ?? {});
    const ua = req.get("user-agent");
    const store = body.success && SLUG_PATTERN.test(req.params.slug) && !isBot(ua) ? await storesRepo.resolvePublicStore(publicDb, req.params.slug) : undefined;
    const visitor = `${req.ip ?? "unknown"}:${req.params.slug}`;
    if (store && body.success && !eventLimiter.blocked(visitor)) {
      eventLimiter.fail(visitor);
      const b = body.data;
      await withStore(db, store.id, (trx) =>
        analyticsRepo.recordEvents(
          trx,
          store.id,
          { id: b.sessionId, source: trafficSource(b.referrer, b.utmSource, ownHosts), device: deviceClass(ua) },
          b.events.map((e) => ({ type: e.type, path: e.path?.split("?")[0]?.slice(0, 300) ?? null, productId: e.productId ?? null })),
        ),
      );
    }
    res.status(202).end();
  });

  /** A product's published reviews and rating summary. */
  router.get("/stores/:slug/products/:handle/reviews", async (req, res) => {
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const product = HANDLE_PATTERN.test(req.params.handle) ? await read(store.id, (trx) => storefrontRepo.productByHandle(trx, req.params.handle)) : undefined;
    if (!product) return problems.notFound(res);
    const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
    // Reviews aren't readable by the public role; only published ones leave this route.
    const found = await withStore(db, store.id, async (trx) => ({
      summary: await reviewsRepo.ratingSummary(trx, product.id),
      reviews: await reviewsRepo.publishedReviews(trx, product.id, REVIEWS_PAGE_SIZE, (page - 1) * REVIEWS_PAGE_SIZE),
    }));
    res.set("Cache-Control", "public, max-age=30");
    res.json({
      summary: found.summary,
      reviews: found.reviews.map((r) => ({ id: r.id, author: r.author_name, rating: r.rating, title: r.title, body: r.body, reply: r.reply, createdAt: r.created_at.toISOString() })),
      page,
      pageSize: REVIEWS_PAGE_SIZE,
    });
  });

  router.post("/stores/:slug/orders/:token/reviews", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const found = await withStore(db, store.id, (trx) => ordersRepo.orderByToken(trx, req.params.token));
    if (!found) return problems.notFound(res);
    await postReview(req, res, store, found.order.id);
  });

  /** The emailed review link: the order's items and the reviews already written. */
  router.get("/stores/:slug/review-requests/:token", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const found = await withStore(db, store.id, async (trx) => {
      const orderId = await reviewsRepo.orderForReviewToken(trx, req.params.token);
      if (!orderId) return undefined;
      const order = await trx.selectFrom("orders").select(["number", "name"]).where("id", "=", orderId).executeTakeFirstOrThrow();
      return { order, items: await reviewsRepo.reviewableItems(trx, orderId) };
    });
    if (!found || found.items === "not_yet") return problems.notFound(res);
    res.json({ number: found.order.number, name: found.order.name.split(/\s+/)[0], items: found.items });
  });

  router.post("/stores/:slug/review-requests/:token/reviews", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const orderId = await withStore(db, store.id, (trx) => reviewsRepo.orderForReviewToken(trx, req.params.token));
    if (!orderId) return problems.notFound(res);
    await postReview(req, res, store, orderId);
  });

  /** A paid order's digital file: counts one download and redirects to a short-lived signed link. */
  router.get("/stores/:slug/orders/:token/downloads/:grantId", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const store = await shopOf(res, req.params.slug);
    if (!store) return;
    const result = UUID_PATTERN.test(req.params.grantId)
      ? await withStore(db, store.id, async (trx) => {
          const found = await ordersRepo.orderByToken(trx, req.params.token);
          return found ? rulesRepo.useDownload(trx, found.order.id, req.params.grantId) : ({ kind: "not_found" } as const);
        })
      : ({ kind: "not_found" } as const);
    if (result.kind === "not_found") {
      problems.notFound(res);
      return;
    }
    if (result.kind !== "ok") {
      sendProblem(res, 410, result.kind === "expired" ? "DOWNLOAD_EXPIRED" : "DOWNLOAD_LIMIT", result.kind === "expired" ? "This download link has expired" : "This file has been downloaded the maximum number of times");
      return;
    }
    res.redirect(302, await objectStore.presignDownload(result.storageKey, result.fileName, result.contentType, 5 * 60));
  });

  /**
   * Shows a public media asset (a product or collection image) by redirecting
   * to a short-lived signed URL. Only ready, public assets resolve; digital
   * products' files never do.
   */
  router.get("/media/:mediaId", async (req, res) => {
    const media = UUID_PATTERN.test(req.params.mediaId) ? await mediaRepo.resolvePublicMedia(publicDb, req.params.mediaId) : undefined;
    if (!media) {
      res.set("Cache-Control", "no-store");
      problems.notFound(res);
      return;
    }
    const url = await objectStore.presignView(media.storageKey, media.contentType, MEDIA_URL_SECONDS);
    // Browsers and CDNs reuse the redirect well within the signed URL's lifetime.
    res.set("Cache-Control", `public, max-age=${MEDIA_CACHE_SECONDS}`);
    res.redirect(302, url);
  });

  return router;
}

/** An order as its shopper sees it, with what to do next for the chosen payment method. */
export function shopperOrder(
  order: Order,
  items: OrderItem[],
  settings: CheckoutSettings,
  store: { name: string; currency: string },
  timezone: string,
  orderUrl: string,
  fulfillments: Fulfillment[] = [],
) {
  const message = chatOrderMessage({
    storeName: store.name,
    number: order.number,
    currency: order.currency,
    lines: items.map((i) => ({ title: i.title, variantTitle: i.variantTitle, quantity: i.quantity, totalMinor: i.totalMinor, bookingAt: i.bookingAt ? bookingLabel(i.bookingAt, timezone) : null })),
    totals: { subtotalMinor: order.subtotalMinor, deliveryMinor: order.deliveryMinor, totalMinor: order.totalMinor },
    name: order.name,
    phone: order.phone,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    note: order.note,
    orderUrl,
  });
  const instructions =
    order.paymentMethod === "bank"
      ? settings.bankInstructions
      : order.paymentMethod === "upi"
        ? [settings.upiId ? `Pay to UPI ID: ${settings.upiId}` : null, settings.upiInstructions].filter(Boolean).join("\n")
        : order.paymentMethod === "cod"
          ? (settings.codInstructions ?? "Pay when your order arrives.")
          : null;
  const chat =
    order.paymentMethod === "whatsapp" && settings.whatsappNumber
      ? { channel: "whatsapp" as const, url: whatsappLink(settings.whatsappNumber, message), message }
      : order.paymentMethod === "telegram" && settings.telegramUsername
        ? { channel: "telegram" as const, url: telegramLink(settings.telegramUsername), message }
        : null;
  return {
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentMethod: order.paymentMethod,
    deliveryMethod: order.deliveryMethod,
    name: order.name,
    email: order.email,
    address: order.address,
    pickupAddress: order.deliveryMethod === "pickup" ? settings.pickupAddress : null,
    note: order.note,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    deliveryMinor: order.deliveryMinor,
    totalMinor: order.totalMinor,
    discountMinor: order.discountMinor,
    discountLabel: order.discountCode ?? order.discountTitle,
    taxMinor: order.taxMinor,
    taxLabel: order.taxLabel,
    pricesIncludeTax: order.pricesIncludeTax,
    shippingRateName: order.shippingRateName,
    refundedMinor: order.refundedMinor,
    placedAt: order.placedAt.toISOString(),
    /** Card orders not yet paid: pay by this time or the order is cancelled. */
    payBy: order.paymentMethod === "card" && order.paymentStatus === "pending" && order.status === "open" ? (order.paymentDueAt?.toISOString() ?? null) : null,
    shipments: fulfillments.map((f) => ({
      carrier: f.carrier,
      trackingNumber: f.trackingNumber,
      trackingUrl: f.trackingUrl,
      units: f.items.reduce((n, i) => n + i.quantity, 0),
      at: f.createdAt.toISOString(),
    })),
    items: items.map((i) => ({
      title: i.title,
      variantTitle: i.variantTitle,
      productType: i.productType,
      imageId: i.imageId,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      totalMinor: i.totalMinor,
      bookingAt: i.bookingAt?.toISOString() ?? null,
      bookingLabel: i.bookingAt ? bookingLabel(i.bookingAt, timezone) : null,
    })),
    paymentInstructions: order.paymentStatus === "pending" && order.status === "open" ? instructions : null,
    chat: order.status === "open" ? chat : null,
  };
}

