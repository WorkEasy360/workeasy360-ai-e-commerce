import { call, hmacHex, sameHex, type Fetch, type GatewayCredentials } from "./gateway.js";

/**
 * Razorpay (UPI, cards, netbanking, wallets) with the merchant's own keys.
 * Flow: we create a Razorpay order for the amount; the shopper pays in
 * Razorpay Checkout; Checkout returns a payment id and a signature we verify
 * with the key secret; the `payment.captured` webhook confirms it again.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 */
const API = "https://api.razorpay.com/v1";

function auth(c: GatewayCredentials): string {
  return `Basic ${Buffer.from(`${c.publicKey}:${c.secretKey}`).toString("base64")}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder(
  fetchFn: Fetch,
  c: GatewayCredentials,
  input: { amountMinor: number; currency: string; receipt: string; orderId: string },
): Promise<RazorpayOrder> {
  return call<RazorpayOrder>(fetchFn, "razorpay", `${API}/orders`, {
    method: "POST",
    headers: { authorization: auth(c), "content-type": "application/json" },
    body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: { order_id: input.orderId } }),
  });
}

/** Checkout's success handler signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyRazorpayPayment(c: GatewayCredentials, input: { razorpayOrderId: string; paymentId: string; signature: string }): boolean {
  return sameHex(hmacHex(c.secretKey, `${input.razorpayOrderId}|${input.paymentId}`), input.signature);
}

/** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret, in X-Razorpay-Signature. */
export function verifyRazorpayWebhook(webhookSecret: string, rawBody: Buffer, signature: string | undefined): boolean {
  return signature !== undefined && sameHex(hmacHex(webhookSecret, rawBody), signature);
}

/** The part of a Razorpay webhook we act on: a captured payment for one of our Razorpay orders. */
export function parseRazorpayEvent(body: unknown): { event: string; payment?: { id: string; orderId: string; amount: number; currency: string; method: string | null } } {
  const b = body as { event?: unknown; payload?: { payment?: { entity?: Record<string, unknown> } } };
  const p = b.payload?.payment?.entity;
  const event = typeof b.event === "string" ? b.event : "";
  if (!p || typeof p.id !== "string" || typeof p.order_id !== "string" || typeof p.amount !== "number") return { event };
  return { event, payment: { id: p.id, orderId: p.order_id, amount: p.amount, currency: String(p.currency ?? ""), method: typeof p.method === "string" ? p.method : null } };
}

export interface RazorpayRefund {
  id: string;
  status: "pending" | "processed" | "failed";
  amount: number;
}

export async function refundRazorpay(fetchFn: Fetch, c: GatewayCredentials, input: { paymentId: string; amountMinor: number; refundKey: string }): Promise<RazorpayRefund> {
  return call<RazorpayRefund>(fetchFn, "razorpay", `${API}/payments/${encodeURIComponent(input.paymentId)}/refund`, {
    method: "POST",
    headers: { authorization: auth(c), "content-type": "application/json" },
    // The receipt doubles as our idempotency reference in Razorpay's records.
    body: JSON.stringify({ amount: input.amountMinor, receipt: input.refundKey.slice(0, 40), notes: { refund_key: input.refundKey } }),
  });
}

/** Test-mode key ids start with rzp_test_; live ones with rzp_live_. */
export function razorpayKeyMode(keyId: string): "test" | "live" | undefined {
  if (keyId.startsWith("rzp_test_")) return "test";
  if (keyId.startsWith("rzp_live_")) return "live";
  return undefined;
}

/** Checks keys by fetching one order page; false when Razorpay refuses them. */
export async function checkRazorpayKeys(fetchFn: Fetch, c: GatewayCredentials): Promise<boolean> {
  try {
    await call(fetchFn, "razorpay", `${API}/orders?count=1`, { method: "GET", headers: { authorization: auth(c) } });
    return true;
  } catch {
    return false;
  }
}
