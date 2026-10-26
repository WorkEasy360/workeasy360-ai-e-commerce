"use client";

/**
 * Taking a card payment in the browser. Razorpay opens its Checkout window
 * over the page (cards, UPI, netbanking, wallets) and hands back a signed
 * result we send to the shop to confirm; Stripe is a redirect to its hosted
 * page, which returns to the order page. Card details never touch the shop.
 */
export type PaymentStart =
  | { provider: "razorpay"; keyId: string; razorpayOrderId: string; amountMinor: number; currency: string; storeName: string; description: string; prefill: { name: string; email: string; contact: string | null } }
  | { provider: "stripe"; url: string }
  | { paid: true }
  | { error: string };

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

type RazorpayCtor = new (options: Record<string, unknown>) => { open(): void; on(event: string, fn: (e: unknown) => void): void };

function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.addEventListener("load", () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay didn't load"))), { once: true });
    script.addEventListener("error", () => reject(new Error("Razorpay didn't load")), { once: true });
    document.head.appendChild(script);
  });
}

/** Where the shopper ends up: "paid" on success, "dismissed" if they closed the window, or a message to show. */
export type PayOutcome = { kind: "paid" } | { kind: "redirecting" } | { kind: "dismissed" } | { kind: "error"; message: string };

export async function pay(slug: string, token: string, start: PaymentStart): Promise<PayOutcome> {
  if ("paid" in start) return { kind: "paid" };
  if ("error" in start) return { kind: "error", message: start.error };
  if (start.provider === "stripe") {
    window.location.assign(start.url);
    return { kind: "redirecting" };
  }
  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await loadRazorpay();
  } catch {
    return { kind: "error", message: "The payment window couldn't load. Check your connection and try again." };
  }
  return new Promise<PayOutcome>((resolve) => {
    const checkout = new Razorpay({
      key: start.keyId,
      order_id: start.razorpayOrderId,
      amount: start.amountMinor,
      currency: start.currency,
      name: start.storeName,
      description: start.description,
      prefill: { name: start.prefill.name, email: start.prefill.email, ...(start.prefill.contact ? { contact: start.prefill.contact } : {}) },
      theme: { color: "#1257C6" },
      modal: { ondismiss: () => resolve({ kind: "dismissed" }) },
      handler: async (r: RazorpayResult) => {
        try {
          const res = await fetch(`/public/v1/stores/${slug}/orders/${token}/payments/razorpay`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ razorpayOrderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
          });
          // Even if this check fails, Razorpay's webhook confirms the payment shortly.
          resolve(res.ok ? { kind: "paid" } : { kind: "error", message: "Your payment went through, but we couldn't confirm it yet. Your order page will update shortly." });
        } catch {
          resolve({ kind: "error", message: "Your payment went through, but we couldn't confirm it yet. Your order page will update shortly." });
        }
      },
    });
    checkout.on("payment.failed", () => {
      // Razorpay shows the failure and lets the shopper try another way in the same window.
    });
    checkout.open();
  });
}

/** Asks the shop to open (or reopen) payment for a card order. */
export async function startPayment(slug: string, token: string): Promise<PaymentStart> {
  try {
    const res = await fetch(`/public/v1/stores/${slug}/orders/${token}/pay`, { method: "POST", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { payment?: PaymentStart; title?: string };
    if (res.ok && body.payment) return body.payment;
    return { error: body.title ?? "The payment couldn't be started. Please try again." };
  } catch {
    return { error: "We couldn't reach the shop. Check your connection and try again." };
  }
}
