import { call, hmacHex, sameHex, type Fetch, type GatewayCredentials } from "./gateway.js";

/**
 * Stripe Checkout with the merchant's own keys. Flow: we create a Checkout
 * Session for the order total and send the shopper to Stripe; on return we
 * read the session to confirm it's paid, and `checkout.session.completed`
 * webhooks confirm it again.
 * https://docs.stripe.com/payments/checkout
 */
const API = "https://api.stripe.com/v1";
/** Signed webhooks older than this are refused, as Stripe recommends. */
export const STRIPE_TOLERANCE_SECONDS = 300;

function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export interface StripeSession {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  status: "open" | "complete" | "expired";
  payment_intent: string | null;
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
}

export async function createStripeSession(
  fetchFn: Fetch,
  c: GatewayCredentials,
  input: {
    amountMinor: number;
    currency: string;
    orderId: string;
    orderLabel: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
    /** One per payment attempt: a retried request returns the same session, a new attempt gets a new one. */
    attemptKey: string;
  },
): Promise<StripeSession> {
  return call<StripeSession>(fetchFn, "stripe", `${API}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `checkout-${input.attemptKey}`,
    },
    body: form({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orderId,
      customer_email: input.email,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": input.amountMinor,
      "line_items[0][price_data][product_data][name]": input.orderLabel,
      "metadata[order_id]": input.orderId,
      "payment_intent_data[metadata][order_id]": input.orderId,
    }),
  });
}

export async function retrieveStripeSession(fetchFn: Fetch, c: GatewayCredentials, sessionId: string): Promise<StripeSession> {
  return call<StripeSession>(fetchFn, "stripe", `${API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${c.secretKey}` },
  });
}

/**
 * Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]; the signature is HMAC-SHA256
 * of "<t>.<raw body>" with the endpoint's signing secret.
 */
export function verifyStripeWebhook(webhookSecret: string, rawBody: Buffer, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string | undefined]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isInteger(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - t) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = hmacHex(webhookSecret, Buffer.concat([Buffer.from(`${t}.`), rawBody]));
  return signatures.some((s) => sameHex(expected, s));
}

export function parseStripeEvent(body: unknown): { id: string; type: string; session?: StripeSession } {
  const b = body as { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
  const id = typeof b.id === "string" ? b.id : "";
  const type = typeof b.type === "string" ? b.type : "";
  const o = b.data?.object;
  if (!o || o.object !== "checkout.session" || typeof o.id !== "string") return { id, type };
  return { id, type, session: o as unknown as StripeSession };
}

export interface StripeRefund {
  id: string;
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
  amount: number;
}

export async function refundStripe(fetchFn: Fetch, c: GatewayCredentials, input: { paymentIntentId: string; amountMinor: number; refundKey: string }): Promise<StripeRefund> {
  return call<StripeRefund>(fetchFn, "stripe", `${API}/refunds`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `refund-${input.refundKey}` },
    body: form({ payment_intent: input.paymentIntentId, amount: input.amountMinor, "metadata[refund_key]": input.refundKey }),
  });
}

/** Checks a secret key by reading the account balance; false when Stripe refuses it. */
export async function checkStripeKeys(fetchFn: Fetch, c: GatewayCredentials): Promise<boolean> {
  try {
    await call(fetchFn, "stripe", `${API}/balance`, { method: "GET", headers: { authorization: `Bearer ${c.secretKey}` } });
    return true;
  } catch {
    return false;
  }
}

/** Test-mode keys start with pk_test_/sk_test_; live keys with pk_live_/sk_live_. */
export function stripeKeyMode(secretKey: string): "test" | "live" | undefined {
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  return undefined;
}
