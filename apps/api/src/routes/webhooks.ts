import express, { Router, type Request, type Response } from "express";
import { moneyRepo, withStore, type GatewayProvider } from "@workeasy/database";
import { parseRazorpayEvent, parseStripeEvent, verifyRazorpayWebhook, verifyStripeWebhook } from "@workeasy/payments";
import type { AppDependencies } from "../app.js";
import { sendProblem } from "../http/problem.js";
import { requestLog } from "../http/request-context.js";
import { credentialsFor, settleStripeSessionIn } from "../payments/gateways.js";
import { UUID_PATTERN } from "./support.js";

/** Gateways send small JSON events; anything bigger isn't one of theirs. */
const WEBHOOK_BODY_LIMIT = "256kb";

/** The refund part of a gateway event, when it's about a refund. */
function refundOf(provider: GatewayProvider, body: unknown): { id: string; status: "pending" | "succeeded" | "failed" } | undefined {
  if (provider === "razorpay") {
    const r = (body as { payload?: { refund?: { entity?: { id?: unknown; status?: unknown } } } }).payload?.refund?.entity;
    if (!r || typeof r.id !== "string") return undefined;
    return { id: r.id, status: r.status === "processed" ? "succeeded" : r.status === "failed" ? "failed" : "pending" };
  }
  const o = (body as { data?: { object?: { object?: unknown; id?: unknown; status?: unknown } } }).data?.object;
  if (!o || o.object !== "refund" || typeof o.id !== "string") return undefined;
  return { id: o.id, status: o.status === "succeeded" ? "succeeded" : o.status === "failed" || o.status === "canceled" ? "failed" : "pending" };
}

/**
 * Gateway webhooks, one URL per store and gateway. Each request is checked
 * against that store's webhook secret over the exact bytes received, and
 * each event is acted on once however often it's delivered. Answers 2xx for
 * events we don't use, so gateways don't keep retrying them.
 */
export function webhooksRouter({ db, payments, logger }: AppDependencies): Router {
  const router = Router();
  router.use(express.raw({ type: "*/*", limit: WEBHOOK_BODY_LIMIT }));

  async function handle(provider: GatewayProvider, req: Request<{ storeId: string }>, res: Response): Promise<void> {
    res.set("Cache-Control", "no-store");
    const storeId = req.params.storeId;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const creds = UUID_PATTERN.test(storeId) ? await withStore(db, storeId, (trx) => credentialsFor(trx, payments, provider)) : undefined;
    if (!creds) {
      sendProblem(res, 404, "NOT_FOUND", "Not found");
      return;
    }
    const signed =
      provider === "razorpay"
        ? verifyRazorpayWebhook(creds.webhookSecret, raw, req.get("x-razorpay-signature"))
        : verifyStripeWebhook(creds.webhookSecret, raw, req.get("stripe-signature"));
    if (!signed) {
      sendProblem(res, 400, "BAD_SIGNATURE", "Signature doesn't match");
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      sendProblem(res, 400, "MALFORMED_JSON", "The request body is not valid JSON");
      return;
    }

    const rzp = provider === "razorpay" ? parseRazorpayEvent(body) : undefined;
    const stripe = provider === "stripe" ? parseStripeEvent(body) : undefined;
    const eventType = rzp?.event ?? stripe?.type ?? "";
    // Razorpay names the event in a header; Stripe in the body.
    const eventId = provider === "razorpay" ? (req.get("x-razorpay-event-id") ?? "") : (stripe?.id ?? "");
    if (!eventId) {
      sendProblem(res, 400, "MISSING_EVENT_ID", "Event id missing");
      return;
    }
    // Recording the event and acting on it commit together: if acting fails, the
    // gateway's retry finds the event unseen and tries again.
    const outcome = await withStore(db, storeId, async (trx) => {
      if (!(await moneyRepo.firstDelivery(trx, storeId, provider, eventId, eventType))) return "duplicate";
      if (rzp?.payment && (eventType === "payment.captured" || eventType === "order.paid")) {
        const p = rzp.payment;
        const payment = await moneyRepo.paymentByRef(trx, "razorpay", p.orderId);
        if (!payment) return "unknown";
        return moneyRepo.confirmGatewayPayment(trx, { storeId, paymentId: payment.id, providerPaymentId: p.id, amountMinor: p.amount, method: p.method });
      }
      if (stripe?.session && (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded")) {
        return (await settleStripeSessionIn(trx, storeId, stripe.session)) ?? "unknown";
      }
      if (stripe?.session && eventType === "checkout.session.expired") {
        const payment = await moneyRepo.paymentByRef(trx, "stripe", stripe.session.id);
        if (payment) await moneyRepo.failGatewayPayment(trx, storeId, payment.id, "checkout expired");
        return "expired";
      }
      const refund = refundOf(provider, body);
      if (refund && refund.status !== "pending") {
        const ours = await moneyRepo.refundByProviderId(trx, refund.id);
        if (ours) await moneyRepo.settleRefund(trx, storeId, ours.id, { status: refund.status, providerRefundId: refund.id });
        return "refund";
      }
      return "ignored";
    });
    if (outcome === "duplicate") {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (outcome === "amount_mismatch" || outcome === "order_closed") requestLog(res, logger).warn({ storeId, provider, outcome, eventId }, "gateway payment needs attention");
    res.status(200).json({ received: true });
  }

  router.post("/razorpay/:storeId", (req, res) => handle("razorpay", req, res));
  router.post("/stripe/:storeId", (req, res) => handle("stripe", req, res));
  return router;
}
