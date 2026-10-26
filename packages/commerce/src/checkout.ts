import { formatMoney } from "./money";

/**
 * Checkout arithmetic and chat-order messages. The API prices every order
 * with these functions from current catalog data; the storefront uses the
 * same ones for its running totals, so both always agree.
 */

export type DeliveryMethod = "delivery" | "pickup" | "none";
export type PaymentMethod = "cod" | "bank" | "upi" | "whatsapp" | "telegram" | "card";

export interface DeliverySettings {
  deliveryEnabled: boolean;
  deliveryFeeMinor: number;
  /** Free delivery when the subtotal reaches this; null for never. */
  freeDeliveryOverMinor: number | null;
  pickupEnabled: boolean;
}

export interface PricedLine {
  productType: "physical" | "digital" | "service";
  unitPriceMinor: number;
  quantity: number;
}

/** Only physical goods travel; digital downloads and services need no delivery. */
export function needsDelivery(lines: readonly PricedLine[]): boolean {
  return lines.some((l) => l.productType === "physical");
}

/** The delivery methods a cart can use under the store's settings. */
export function deliveryOptions(lines: readonly PricedLine[], settings: DeliverySettings): DeliveryMethod[] {
  if (!needsDelivery(lines)) return ["none"];
  const options: DeliveryMethod[] = [];
  if (settings.deliveryEnabled) options.push("delivery");
  if (settings.pickupEnabled) options.push("pickup");
  return options;
}

export function deliveryCharge(subtotalMinor: number, method: DeliveryMethod, settings: DeliverySettings): number {
  if (method !== "delivery") return 0;
  if (settings.freeDeliveryOverMinor !== null && subtotalMinor >= settings.freeDeliveryOverMinor) return 0;
  return settings.deliveryFeeMinor;
}

export interface Totals {
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
}

export function totals(lines: readonly PricedLine[], method: DeliveryMethod, settings: DeliverySettings): Totals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  const deliveryMinor = deliveryCharge(subtotalMinor, method, settings);
  return { subtotalMinor, deliveryMinor, totalMinor: subtotalMinor + deliveryMinor };
}

export interface ChatOrder {
  storeName: string;
  number: number;
  currency: string;
  lines: Array<{ title: string; variantTitle: string | null; quantity: number; totalMinor: number; bookingAt?: string | null }>;
  totals: Totals;
  name: string;
  phone: string | null;
  deliveryMethod: DeliveryMethod;
  address: { line1: string; line2?: string | null; city: string; state?: string | null; postalCode: string } | null;
  note: string | null;
  /** Where the shopper (and the merchant) can see the order. */
  orderUrl: string;
}

/**
 * The message a shopper sends to place a chat order: order number, items,
 * totals, delivery details and a link to the order. Plain text, so it reads
 * well in WhatsApp and Telegram alike.
 */
export function chatOrderMessage(o: ChatOrder, locale = "en-IN"): string {
  const money = (m: number) => formatMoney(m, o.currency, locale, { compact: true });
  const lines = [
    `Hi ${o.storeName}! I'd like to place order #${o.number}:`,
    "",
    ...o.lines.map((l) => `• ${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}: ${money(l.totalMinor)}${l.bookingAt ? `, for ${l.bookingAt}` : ""}`),
    "",
    `Subtotal: ${money(o.totals.subtotalMinor)}`,
    ...(o.deliveryMethod === "delivery" ? [`Delivery: ${o.totals.deliveryMinor === 0 ? "Free" : money(o.totals.deliveryMinor)}`] : []),
    `Total: ${money(o.totals.totalMinor)}`,
    "",
    `Name: ${o.name}`,
    ...(o.phone ? [`Phone: ${o.phone}`] : []),
    ...(o.deliveryMethod === "delivery" && o.address
      ? [`Deliver to: ${[o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.postalCode].filter(Boolean).join(", ")}`]
      : o.deliveryMethod === "pickup"
        ? ["I'll pick it up."]
        : []),
    ...(o.note ? [`Note: ${o.note}`] : []),
    "",
    `Order details: ${o.orderUrl}`,
  ];
  return lines.join("\n");
}

/** A WhatsApp link that opens a chat with the store, message filled in. */
export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** A Telegram link to the store's account. Telegram can't pre-fill a chat, so the storefront copies the message for pasting. */
export function telegramLink(username: string): string {
  return `https://t.me/${encodeURIComponent(username.replace(/^@/, ""))}`;
}
