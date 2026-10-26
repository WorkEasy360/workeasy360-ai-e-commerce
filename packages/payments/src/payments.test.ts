import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GatewayError, type Fetch } from "./gateway.js";
import { createRazorpayOrder, parseRazorpayEvent, razorpayKeyMode, refundRazorpay, verifyRazorpayPayment, verifyRazorpayWebhook } from "./razorpay.js";
import { decryptSecret, encryptSecret, maskSecret, parseSecretKey } from "./secrets.js";
import { createStripeSession, parseStripeEvent, stripeKeyMode, verifyStripeWebhook } from "./stripe.js";

const rzp = { publicKey: "rzp_test_abc123", secretKey: "rzp_secret_xyz", webhookSecret: "rzp_whsec" };
const stripe = { publicKey: "pk_test_123", secretKey: "sk_test_456", webhookSecret: "whsec_789" };
const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");

/** A fake gateway that records requests and answers with `reply`. */
function fakeFetch(status: number, reply: unknown) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string | undefined }> = [];
  const fn: Fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return { status, json: async () => reply };
  };
  return { fn, calls };
}

describe("secrets", () => {
  it("round-trips and refuses tampering or the wrong key", () => {
    const key = randomBytes(32);
    const stored = encryptSecret("sk_live_secret", key);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("sk_live");
    expect(decryptSecret(stored, key)).toBe("sk_live_secret");
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(/authenticate/);
    expect(() => decryptSecret(`${stored.slice(0, -2)}AA`, key)).toThrow(/authenticate/);
    expect(() => parseSecretKey(Buffer.alloc(16).toString("base64"))).toThrow("must be 32 bytes");
    expect(maskSecret("sk_test_abcd1234")).toBe("••••••1234");
  });
});

describe("razorpay", () => {
  it("creates orders with basic auth and the amount in paise", async () => {
    const { fn, calls } = fakeFetch(200, { id: "order_1", amount: 74800, currency: "INR", status: "created" });
    const order = await createRazorpayOrder(fn, rzp, { amountMinor: 74800, currency: "INR", receipt: "Order #1001", orderId: "o-1" });
    expect(order.id).toBe("order_1");
    expect(calls[0]).toMatchObject({ url: "https://api.razorpay.com/v1/orders", method: "POST" });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("rzp_test_abc123:rzp_secret_xyz").toString("base64")}`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: 74800, currency: "INR", receipt: "Order #1001", notes: { order_id: "o-1" } });
  });

  it("verifies Checkout and webhook signatures, and nothing else", () => {
    const signature = hmac(rzp.secretKey, "order_1|pay_9");
    expect(verifyRazorpayPayment(rzp, { razorpayOrderId: "order_1", paymentId: "pay_9", signature })).toBe(true);
    expect(verifyRazorpayPayment(rzp, { razorpayOrderId: "order_1", paymentId: "pay_8", signature })).toBe(false);
    expect(verifyRazorpayPayment(rzp, { razorpayOrderId: "order_1", paymentId: "pay_9", signature: "not-hex" })).toBe(false);
    const body = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_9", order_id: "order_1", amount: 74800, currency: "INR", method: "upi" } } } }));
    expect(verifyRazorpayWebhook(rzp.webhookSecret, body, hmac(rzp.webhookSecret, body.toString()))).toBe(true);
    expect(verifyRazorpayWebhook(rzp.webhookSecret, Buffer.concat([body, Buffer.from(" ")]), hmac(rzp.webhookSecret, body.toString()))).toBe(false);
    expect(verifyRazorpayWebhook(rzp.webhookSecret, body, undefined)).toBe(false);
    expect(parseRazorpayEvent(JSON.parse(body.toString()))).toEqual({ event: "payment.captured", payment: { id: "pay_9", orderId: "order_1", amount: 74800, currency: "INR", method: "upi" } });
  });

  it("maps gateway failures to safe codes", async () => {
    await expect(refundRazorpay(fakeFetch(401, {}).fn, rzp, { paymentId: "pay_9", amountMinor: 100, refundKey: "r1" })).rejects.toMatchObject({ code: "razorpay_auth_failed", retryable: false });
    await expect(refundRazorpay(fakeFetch(503, {}).fn, rzp, { paymentId: "pay_9", amountMinor: 100, refundKey: "r1" })).rejects.toBeInstanceOf(GatewayError);
    expect(razorpayKeyMode("rzp_live_x")).toBe("live");
    expect(razorpayKeyMode("abc")).toBeUndefined();
  });
});

describe("stripe", () => {
  it("creates a Checkout Session as a form post with an idempotency key", async () => {
    const { fn, calls } = fakeFetch(200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1", payment_status: "unpaid", status: "open" });
    const session = await createStripeSession(fn, stripe, {
      amountMinor: 74800,
      currency: "INR",
      orderId: "o-1",
      orderLabel: "Order #1001 · Chai & Co",
      email: "ravi@example.com",
      successUrl: "https://shop.test/s/chai/order/t?paid=1",
      cancelUrl: "https://shop.test/s/chai/order/t",
      attemptKey: "p-1",
    });
    expect(session.url).toContain("checkout.stripe.com");
    const call0 = calls[0]!;
    expect(call0.headers).toMatchObject({ authorization: "Bearer sk_test_456", "idempotency-key": "checkout-p-1" });
    const params = new URLSearchParams(call0.body);
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("74800");
    expect(params.get("line_items[0][price_data][currency]")).toBe("inr");
    expect(params.get("metadata[order_id]")).toBe("o-1");
    expect(params.get("line_items[0][price_data][product_data][name]")).toBe("Order #1001 · Chai & Co");
  });

  it("verifies signed webhooks within the tolerance window only", () => {
    const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { object: "checkout.session", id: "cs_1", payment_status: "paid" } } }));
    const t = 1_800_000_000;
    const sig = hmac(stripe.webhookSecret, `${t}.${body.toString()}`);
    expect(verifyStripeWebhook(stripe.webhookSecret, body, `t=${t},v1=${sig}`, t + 10)).toBe(true);
    expect(verifyStripeWebhook(stripe.webhookSecret, body, `t=${t},v1=deadbeef,v1=${sig}`, t)).toBe(true);
    expect(verifyStripeWebhook(stripe.webhookSecret, body, `t=${t},v1=${sig}`, t + 301)).toBe(false);
    expect(verifyStripeWebhook("whsec_other", body, `t=${t},v1=${sig}`, t)).toBe(false);
    expect(verifyStripeWebhook(stripe.webhookSecret, body, `v1=${sig}`, t)).toBe(false);
    expect(parseStripeEvent(JSON.parse(body.toString()))).toMatchObject({ id: "evt_1", type: "checkout.session.completed", session: { id: "cs_1", payment_status: "paid" } });
    expect(stripeKeyMode("sk_live_x")).toBe("live");
    expect(stripeKeyMode("pk_test_x")).toBeUndefined();
  });
});
