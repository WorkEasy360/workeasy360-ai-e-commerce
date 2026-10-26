import type { Response, Router } from "express";
import { auditRepo, moneyRepo, ordersRepo, rulesRepo, storesRepo, withStore, type GatewayProvider } from "@workeasy/database";
import {
  checkRazorpayKeys,
  checkStripeKeys,
  encryptSecret,
  GatewayError,
  maskSecret,
  razorpayKeyMode,
  refundRazorpay,
  refundStripe,
  stripeKeyMode,
  type GatewayCredentials,
} from "@workeasy/payments";
import type { AppDependencies } from "../app.js";
import { CustomerListQuerySchema, FulfillmentBodySchema, LedgerQuerySchema, PaymentAccountBodySchema, RefundBodySchema } from "../contract/money.js";
import { problems, sendProblem } from "../http/problem.js";
import { credentialsFor } from "../payments/gateways.js";
import { invoicePdf } from "../payments/invoice.js";
import { orderDetail } from "./orders.js";
import { actorOf, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess } from "./support.js";

const PROVIDERS = ["razorpay", "stripe"] as const;
const PAGE_SIZE = 50;

function providerOf(value: string): GatewayProvider | undefined {
  return PROVIDERS.find((p) => p === value);
}

/** Where each gateway should send this store's webhooks. */
function webhookUrls(apiOrigin: string, storeId: string) {
  return Object.fromEntries(PROVIDERS.map((p) => [p, new URL(`/webhooks/${p}/${storeId}`, apiOrigin).toString()])) as Record<GatewayProvider, string>;
}

/**
 * Payments & Finances: connecting the store's own Razorpay and Stripe
 * accounts, takings and the payments ledger; and the money side of orders
 * (refunds, shipments, invoices), customers and abandoned checkouts.
 */
export function moneyRoutes(router: Router, { db, payments, settings }: AppDependencies, { withPermission }: StoreAccess): void {
  const apiOrigin = settings.apiOrigin ?? settings.adminOrigin;

  router.get("/stores/:storeId/payment-accounts", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, ["payments.manage", "finances.read"], async (trx) => ({
        kind: "ok",
        body: {
          accounts: (await moneyRepo.listAccounts(trx)).map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
          webhookUrls: webhookUrls(apiOrigin, req.params.storeId),
          configured: payments.secretsKey !== undefined,
        },
      })),
    );
  });

  /**
   * Connects (or updates) a gateway with the merchant's keys. The keys are
   * checked with the gateway before they're stored, encrypted.
   */
  router.put("/stores/:storeId/payment-accounts/:provider", async (req, res) => {
    const provider = providerOf(req.params.provider);
    if (!provider) {
      problems.notFound(res);
      return;
    }
    const body = PaymentAccountBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const key = payments.secretsKey;
    if (!key) {
      sendProblem(res, 503, "PAYMENTS_NOT_CONFIGURED", "Card payments aren't set up on this server yet (SECRETS_ENCRYPTION_KEY)");
      return;
    }
    const b = body.data;
    // First find what's stored, so a secret left blank keeps the saved one.
    const existing = await withPermission(res, req.params.storeId, "payments.manage", async (trx) => ({ kind: "ok", body: await credentialsFor(trx, payments, provider) }));
    if (typeof existing === "symbol" || existing.kind !== "ok") {
      respond(res, existing);
      return;
    }
    const secretKey = b.secretKey ?? existing.body?.secretKey;
    const webhookSecret = b.webhookSecret ?? existing.body?.webhookSecret;
    if (!secretKey) return respond(res, invalid("secretKey", "Paste your secret key"));
    if (!webhookSecret) return respond(res, invalid("webhookSecret", "Paste your webhook secret"));

    const mode = provider === "razorpay" ? razorpayKeyMode(b.publicKey) : stripeKeyMode(secretKey);
    if (!mode) {
      return respond(res, invalid(provider === "razorpay" ? "publicKey" : "secretKey", provider === "razorpay" ? "Razorpay key ids start with rzp_test_ or rzp_live_" : "Stripe secret keys start with sk_test_ or sk_live_"));
    }
    if (provider === "stripe" && !/^pk_(test|live)_/.test(b.publicKey)) return respond(res, invalid("publicKey", "Stripe publishable keys start with pk_test_ or pk_live_"));
    if (provider === "stripe" && !b.publicKey.startsWith(`pk_${mode}_`)) return respond(res, invalid("publicKey", "Use the publishable and secret key from the same mode (test or live)"));

    const creds: GatewayCredentials = { publicKey: b.publicKey, secretKey, webhookSecret };
    const keysWork = provider === "razorpay" ? await checkRazorpayKeys(payments.fetch, creds) : await checkStripeKeys(payments.fetch, creds);
    if (!keysWork) return respond(res, invalid("secretKey", `${provider === "razorpay" ? "Razorpay" : "Stripe"} didn't accept these keys. Check you copied them from the right account and mode`));

    respond(
      res,
      await withPermission(res, req.params.storeId, "payments.manage", async (trx, _m, userId) => {
        const saved = await moneyRepo.saveAccount(trx, req.params.storeId, {
          provider,
          mode,
          publicKey: b.publicKey,
          secretKeyEnc: encryptSecret(secretKey, key),
          webhookSecretEnc: encryptSecret(webhookSecret, key),
          secretKeyHint: maskSecret(secretKey),
          enabled: b.enabled,
          connectedBy: userId,
        });
        // Never the keys themselves: which gateway, which mode, whether it's on.
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "payments.connected", resourceType: "store", resourceId: req.params.storeId, metadata: { provider, mode, enabled: b.enabled } });
        return { kind: "ok", body: { account: { ...saved, createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString() } } };
      }),
    );
  });

  router.delete("/stores/:storeId/payment-accounts/:provider", async (req, res) => {
    const provider = providerOf(req.params.provider);
    if (!provider) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "payments.manage", async (trx) => {
        if (!(await moneyRepo.deleteAccount(trx, provider))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "payments.disconnected", resourceType: "store", resourceId: req.params.storeId, metadata: { provider } });
        return { kind: "ok", body: {}, status: 200 };
      }),
    );
  });

  router.get("/stores/:storeId/finances", async (req, res) => {
    const query = LedgerQuerySchema.safeParse(req.query);
    if (!query.success) {
      problems.validation(res, issuesToErrors(query.error));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "finances.read", async (trx) => {
        const since = new Date(Date.now() - query.data.days * 86_400_000);
        const page = await moneyRepo.ledger(trx, { limit: PAGE_SIZE, offset: (query.data.page - 1) * PAGE_SIZE });
        return {
          kind: "ok",
          body: {
            summary: { ...(await moneyRepo.financeSummary(trx, since)), since: since.toISOString(), currency: (await storesRepo.getStore(trx))!.currency },
            entries: page.entries.map((e) => ({ ...e, at: e.at.toISOString() })),
            page: query.data.page,
            more: page.more,
          },
        };
      }),
    );
  });

  // Refunds ------------------------------------------------------------------------------------

  /**
   * Refunds part or all of a paid order. A card refund is recorded first,
   * then sent to the gateway with the refund's id as the idempotency key;
   * the gateway's answer (or its webhook, if the answer is lost) settles it.
   */
  router.post("/stores/:storeId/orders/:orderId/refunds", async (req, res) => {
    const { storeId, orderId } = req.params;
    if (!UUID_PATTERN.test(orderId)) {
      problems.notFound(res);
      return;
    }
    const body = RefundBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const b = body.data;
    const started = await withPermission(res, storeId, "orders.refund", async (trx, _m, userId) => {
      let paymentId: string | null = null;
      let send: { provider: GatewayProvider; providerPaymentId: string; creds: GatewayCredentials } | undefined;
      if (b.method === "gateway") {
        const paid = (await moneyRepo.orderPayments(trx, orderId)).find((p) => p.status === "succeeded" && p.provider !== "manual" && p.providerPaymentId);
        if (!paid) return invalid("method", "This order wasn't paid online. Record a refund made outside the store instead");
        const creds = await credentialsFor(trx, payments, paid.provider as GatewayProvider);
        if (!creds) return invalid("method", `Reconnect ${paid.provider === "razorpay" ? "Razorpay" : "Stripe"} in Payments to refund to the card`);
        paymentId = paid.id;
        send = { provider: creds.provider, providerPaymentId: paid.providerPaymentId!, creds };
      }
      const result = await moneyRepo.createRefund(trx, { storeId, orderId, amountMinor: b.amountMinor, reason: b.reason, paymentId, actorId: userId, restock: b.restock });
      if (result.kind === "not_found") return { kind: "not_found" };
      if (result.kind === "not_paid") return { kind: "conflict", code: "ORDER_NOT_PAID", title: "Only paid orders can be refunded" };
      if (result.kind === "too_much") return invalid("amountMinor", result.availableMinor === 0 ? "This order is fully refunded" : "That's more than is left to refund");
      await auditRepo.appendAudit(trx, { storeId, ...actorOf(res), action: "order.refunded", resourceType: "order", resourceId: orderId, metadata: { amountMinor: b.amountMinor, method: b.method } });
      return { kind: "ok", body: { refundId: result.refundId, send } };
    });
    if (typeof started === "symbol" || started.kind !== "ok") {
      respond(res, started);
      return;
    }
    const { refundId, send } = started.body;
    if (send) {
      let settle: Parameters<typeof moneyRepo.settleRefund>[3];
      try {
        if (send.provider === "razorpay") {
          const r = await refundRazorpay(payments.fetch, send.creds, { paymentId: send.providerPaymentId, amountMinor: b.amountMinor, refundKey: refundId });
          settle = { status: r.status === "processed" ? "succeeded" : r.status === "failed" ? "failed" : "pending", providerRefundId: r.id };
        } else {
          const r = await refundStripe(payments.fetch, send.creds, { paymentIntentId: send.providerPaymentId, amountMinor: b.amountMinor, refundKey: refundId });
          settle = { status: r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "canceled" ? "failed" : "pending", providerRefundId: r.id };
        }
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
        // A refusal is final; an outage may still have gone through, so it stays pending for the webhook.
        settle = err.retryable ? { status: "pending", failureCode: err.code } : { status: "failed", failureCode: err.code };
      }
      await withStore(db, storeId, async (trx) => {
        if (settle.status === "pending") {
          if (settle.providerRefundId) await trx.updateTable("refunds").set({ provider_refund_id: settle.providerRefundId, failure_code: settle.failureCode ?? null }).where("id", "=", refundId).execute();
          return;
        }
        await moneyRepo.settleRefund(trx, storeId, refundId, settle);
      });
    }
    respond(res, await withPermission(res, storeId, "orders.read", async (trx) => ({ kind: "ok", status: 201, body: (await orderDetail(trx, orderId))! })));
  });

  // Shipments ----------------------------------------------------------------------------------

  router.post("/stores/:storeId/orders/:orderId/fulfillments", async (req, res) => {
    const { storeId, orderId } = req.params;
    if (!UUID_PATTERN.test(orderId)) {
      problems.notFound(res);
      return;
    }
    const body = FulfillmentBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    respond(
      res,
      await withPermission(res, storeId, "orders.manage", async (trx, _m, userId) => {
        const result = await ordersRepo.createFulfillment(trx, { storeId, orderId, ...body.data, actorId: userId });
        if (result.kind === "not_found") return { kind: "not_found" };
        if (result.kind === "not_allowed") return { kind: "conflict", code: "ORDER_STATE", title: result.message };
        await auditRepo.appendAudit(trx, { storeId, ...actorOf(res), action: "order.fulfilled", resourceType: "order", resourceId: orderId, metadata: { fulfillmentId: result.fulfillmentId, notify: body.data.notify } });
        return { kind: "ok", status: 201, body: (await orderDetail(trx, orderId))! };
      }),
    );
  });

  router.get("/stores/:storeId/orders/:orderId/invoice.pdf", async (req, res) => {
    const { storeId, orderId } = req.params;
    if (!UUID_PATTERN.test(orderId)) {
      problems.notFound(res);
      return;
    }
    const found = await withPermission(res, storeId, "orders.read", async (trx) => {
      const o = await ordersRepo.getOrderWithItems(trx, orderId);
      const store = await storesRepo.getStore(trx);
      return o && store ? { kind: "ok", body: invoicePdf(o.order, o.items, { name: store.name, contactEmail: store.contactEmail, timezone: store.timezone, taxRegistration: (await rulesRepo.getTaxSettings(trx)).registrationNumber }), headers: { number: String(o.order.number) } } : { kind: "not_found" };
    });
    if (typeof found === "symbol" || found.kind !== "ok") {
      respond(res, found);
      return;
    }
    sendPdf(res, found.body, `invoice-${found.headers?.number ?? "order"}.pdf`);
  });

  // Customers and abandoned checkouts --------------------------------------------------------

  router.get("/stores/:storeId/customers", async (req, res) => {
    const query = CustomerListQuerySchema.safeParse(req.query);
    if (!query.success) {
      problems.validation(res, issuesToErrors(query.error));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, ["customers.read", "orders.read"], async (trx) => {
        const page = await moneyRepo.listCustomers(trx, { q: query.data.q, limit: PAGE_SIZE, offset: (query.data.page - 1) * PAGE_SIZE });
        return {
          kind: "ok",
          body: {
            items: page.items.map((c) => ({ ...c, lastOrderAt: c.lastOrderAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() })),
            total: page.total,
            page: query.data.page,
            pageSize: PAGE_SIZE,
          },
        };
      }),
    );
  });

  router.get("/stores/:storeId/customers/:customerId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.customerId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, ["customers.read", "orders.read"], async (trx) => {
        const c = await moneyRepo.getCustomer(trx, req.params.customerId);
        if (!c) return { kind: "not_found" };
        const orders = await ordersRepo.listOrders(trx, { tab: "all", q: c.email, limit: 100 });
        return {
          kind: "ok",
          body: {
            customer: { ...c, lastOrderAt: c.lastOrderAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() },
            orders: orders.items.filter((o) => o.email === c.email).map(({ placedAtKey: _key, ...o }) => ({ ...o, placedAt: o.placedAt.toISOString() })),
          },
        };
      }),
    );
  });

  router.get("/stores/:storeId/checkouts/abandoned", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, ["customers.read", "orders.read"], async (trx) => ({
        kind: "ok",
        body: { items: (await moneyRepo.abandonedCheckouts(trx)).map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })) },
      })),
    );
  });

}

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Content-Length": String(pdf.length) });
  res.status(200).end(pdf);
}
