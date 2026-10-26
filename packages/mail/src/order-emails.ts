import { formatMoney } from "@workeasy/commerce";
import { checkoutRepo, ordersRepo, withStore, type CheckoutSettings, type Db, type Fulfillment, type Order, type OrderItem } from "@workeasy/database";
import { PermanentJobError, RetryLaterError, type JobDefinition } from "@workeasy/jobs";
import { headerSafe, type Mailer } from "./mailer.js";

/**
 * The orders.notify job: when an order is placed, the shopper gets a
 * confirmation with the link to their order and how to pay, and the store's
 * contact address gets a new-order alert with a link to the admin.
 */
export const ORDER_NOTIFY_JOB = "orders.notify";

export interface OrderEmailDeps {
  workerDb: Db;
  mailer: Mailer | undefined;
  storefrontUrl: string;
  adminUrl: string;
  log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
}

const PAYMENT: Record<Order["paymentMethod"], string> = {
  cod: "Cash on delivery",
  bank: "Bank transfer",
  upi: "UPI",
  whatsapp: "Order on WhatsApp",
  telegram: "Order on Telegram",
  card: "Paid online",
};

function lineText(i: OrderItem, currency: string): string {
  return `  ${i.quantity} × ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}  ${formatMoney(i.totalMinor, currency, "en-IN", { compact: true })}`;
}

function totalsText(o: Order): string[] {
  const m = (v: number) => formatMoney(v, o.currency, "en-IN", { compact: true });
  return [
    `  Subtotal: ${m(o.subtotalMinor)}`,
    ...(o.discountMinor > 0 ? [`  Discount${o.discountCode ? ` (${o.discountCode})` : ""}: -${m(o.discountMinor)}`] : []),
    ...(o.deliveryMethod === "delivery" ? [`  Delivery${o.shippingRateName ? ` (${o.shippingRateName})` : ""}: ${o.deliveryMinor === 0 ? "Free" : m(o.deliveryMinor)}`] : []),
    ...(o.taxLabel && !o.pricesIncludeTax ? [`  ${o.taxLabel}: ${m(o.taxMinor)}`] : []),
    `  Total: ${m(o.totalMinor)}`,
    ...(o.taxLabel && o.pricesIncludeTax && o.taxMinor > 0 ? [`  (includes ${m(o.taxMinor)} ${o.taxLabel})`] : []),
  ];
}

function nextStep(o: Order, s: CheckoutSettings): string[] {
  switch (o.paymentMethod) {
    case "bank":
      return ["How to pay:", s.bankInstructions ?? "The shop will send you its bank details.", `Mention order #${o.number} with your payment.`];
    case "upi":
      return ["How to pay:", ...(s.upiId ? [`Pay to UPI ID ${s.upiId}`] : []), ...(s.upiInstructions ? [s.upiInstructions] : []), `Mention order #${o.number} with your payment.`];
    case "cod":
      return [s.codInstructions ?? "Pay when your order arrives."];
    case "whatsapp":
    case "telegram":
      return ["If you haven't sent your order message yet, open your order page and tap the button to send it. The shop confirms payment in the chat."];
    case "card":
      return ["Your payment went through; nothing more to do."];
  }
}

export function customerEmail(o: Order, items: OrderItem[], s: CheckoutSettings, storeName: string, orderUrl: string): { subject: string; text: string } {
  const text = [
    `Hi ${o.name},`,
    "",
    `Thanks for your order from ${storeName}. Here's what you ordered:`,
    "",
    `Order #${o.number}`,
    ...items.map((i) => lineText(i, o.currency)),
    ...totalsText(o),
    "",
    `Payment: ${PAYMENT[o.paymentMethod]}`,
    ...nextStep(o, s),
    "",
    ...(o.deliveryMethod === "pickup" && s.pickupAddress ? [`Pick up from: ${s.pickupAddress}`, ""] : []),
    ...(items.some((i) => i.productType === "digital") ? [`Your downloads appear on your order page once payment is confirmed.`, ""] : []),
    `See your order any time: ${orderUrl}`,
    "",
    `— ${storeName}`,
  ].join("\n");
  return { subject: headerSafe(`Order #${o.number} received: ${storeName}`), text };
}

export function merchantEmail(o: Order, items: OrderItem[], storeName: string, adminOrderUrl: string): { subject: string; text: string } {
  const text = [
    `New order #${o.number} for ${storeName}.`,
    "",
    ...items.map((i) => lineText(i, o.currency)),
    ...totalsText(o),
    "",
    `Customer: ${o.name} <${o.email}>${o.phone ? `, ${o.phone}` : ""}`,
    `Payment: ${PAYMENT[o.paymentMethod]} (${o.paymentStatus})`,
    `Delivery: ${o.deliveryMethod === "delivery" && o.address ? [o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.postalCode].filter(Boolean).join(", ") : o.deliveryMethod === "pickup" ? "Pickup" : "Nothing to deliver"}`,
    ...(o.note ? [`Note: ${o.note}`] : []),
    "",
    `Open the order: ${adminOrderUrl}`,
  ].join("\n");
  return { subject: headerSafe(`New order #${o.number}: ${formatMoney(o.totalMinor, o.currency, "en-IN", { compact: true })} from ${o.name}`), text };
}

export function orderNotifyJob(deps: OrderEmailDeps): JobDefinition {
  return {
    events: [ordersRepo.ORDER_PLACED_V1],
    async handle(ctx) {
      const data = (ctx.payload.data ?? {}) as { orderId?: unknown; accessToken?: unknown };
      if (typeof data.orderId !== "string" || typeof data.accessToken !== "string") throw new PermanentJobError("bad_payload");
      if (!deps.mailer) throw new PermanentJobError("email_not_configured");
      const { orderId, accessToken } = data;
      const loaded = await withStore(deps.workerDb, ctx.storeId, async (trx) => {
        const found = await ordersRepo.getOrderWithItems(trx, orderId);
        const store = await trx.selectFrom("stores").select(["name", "slug", "contact_email"]).executeTakeFirst();
        return found && store ? { ...found, store, settings: await checkoutRepo.getCheckoutSettings(trx) } : undefined;
      });
      if (!loaded) throw new PermanentJobError("order_missing");
      const { order, items, store, settings } = loaded;
      // Card orders are confirmed once paid. Until then, check back on a growing
      // schedule (1, 2, 4, 8, 16 minutes) that outlasts the payment window; an order
      // cancelled for non-payment gets no email.
      if (order.status === "cancelled") return;
      if (order.paymentMethod === "card" && order.paymentStatus === "pending") {
        throw new RetryLaterError("awaiting_payment", Math.min(2 ** (ctx.attempt - 1), 16) * 60_000);
      }
      const orderUrl = new URL(`/s/${store.slug}/order/${accessToken}`, deps.storefrontUrl).toString();
      const adminUrl = new URL(`/s/${ctx.storeId}/orders/${order.id}`, deps.adminUrl).toString();

      const messages = [{ to: order.email, who: "customer", ...customerEmail(order, items, settings, store.name, orderUrl) }];
      if (store.contact_email) messages.push({ to: store.contact_email, who: "store", ...merchantEmail(order, items, store.name, adminUrl) });
      for (const m of messages) {
        // The dedupe key makes the Message-ID stable, so a retried job doesn't look like a new email.
        const result = await deps.mailer.send({ to: [m.to], subject: m.subject, text: m.text, messageId: `<${ctx.dedupeKey}.${m.who}@orders.workeasy360>` });
        if (!result.ok) {
          deps.log?.("warn", "order email not accepted", { orderId, code: result.code });
          if (result.retryable) throw new RetryLaterError(result.code, 60_000);
          throw new PermanentJobError(result.code);
        }
      }
      await withStore(deps.workerDb, ctx.storeId, (trx) =>
        trx
          .insertInto("order_events")
          .values({ store_id: ctx.storeId, order_id: orderId, kind: "email_sent", message: store.contact_email ? "Confirmation emailed to the customer; new-order alert sent to the store" : "Confirmation emailed to the customer" })
          .execute(),
      );
    },
  };
}

/**
 * The orders.shipped job: when a fulfilment is recorded with "notify the
 * customer", the shopper gets the items shipped and the tracking link.
 */
export const ORDER_SHIPPED_JOB = "orders.shipped";

export function shippedEmail(o: Order, items: OrderItem[], f: Fulfillment, storeName: string, orderUrl: string | null): { subject: string; text: string } {
  const lines = f.items.map((fi) => {
    const i = items.find((x) => x.id === fi.orderItemId);
    return `  ${fi.quantity} × ${i?.title ?? "Item"}${i?.variantTitle ? ` (${i.variantTitle})` : ""}`;
  });
  const text = [
    `Hi ${o.name},`,
    "",
    o.fulfillmentStatus === "fulfilled" ? `Good news: your order #${o.number} from ${storeName} is on its way.` : `Part of your order #${o.number} from ${storeName} is on its way:`,
    "",
    ...lines,
    "",
    ...(f.trackingNumber ? [`Tracking: ${f.carrier ? `${f.carrier} ` : ""}${f.trackingNumber}`] : []),
    ...(f.trackingUrl ? [`Track it here: ${f.trackingUrl}`] : []),
    ...(orderUrl ? ["", `Your order: ${orderUrl}`] : []),
    "",
    `— ${storeName}`,
  ].join("\n");
  return { subject: headerSafe(`Order #${o.number} has shipped: ${storeName}`), text };
}

export function orderShippedJob(deps: OrderEmailDeps): JobDefinition {
  return {
    events: [ordersRepo.ORDER_FULFILLED_V1],
    async handle(ctx) {
      const data = (ctx.payload.data ?? {}) as { orderId?: unknown; fulfillmentId?: unknown };
      if (typeof data.orderId !== "string" || typeof data.fulfillmentId !== "string") throw new PermanentJobError("bad_payload");
      if (!deps.mailer) throw new PermanentJobError("email_not_configured");
      const { orderId, fulfillmentId } = data;
      const loaded = await withStore(deps.workerDb, ctx.storeId, async (trx) => {
        const found = await ordersRepo.getOrderWithItems(trx, orderId);
        const f = (await ordersRepo.listFulfillments(trx, orderId)).find((x) => x.id === fulfillmentId);
        const store = await trx.selectFrom("stores").select(["name"]).executeTakeFirst();
        return found && f && store ? { ...found, f, store } : undefined;
      });
      if (!loaded) throw new PermanentJobError("order_missing");
      const { order, items, f, store } = loaded;
      // The order link token is only ever shown to the shopper, so this email points to tracking alone.
      const m = shippedEmail(order, items, f, store.name, null);
      const result = await deps.mailer.send({ to: [order.email], subject: m.subject, text: m.text, messageId: `<${ctx.dedupeKey}.shipped@orders.workeasy360>` });
      if (!result.ok) {
        deps.log?.("warn", "shipping email not accepted", { orderId, code: result.code });
        if (result.retryable) throw new RetryLaterError(result.code, 60_000);
        throw new PermanentJobError(result.code);
      }
      await withStore(deps.workerDb, ctx.storeId, (trx) =>
        trx.insertInto("order_events").values({ store_id: ctx.storeId, order_id: orderId, kind: "email_sent", message: "Shipping update emailed to the customer" }).execute(),
      );
    },
  };
}
