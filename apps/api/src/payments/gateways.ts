import { randomUUID } from "node:crypto";
import { moneyRepo, withStore, type Db, type GatewayProvider, type Order } from "@workeasy/database";
import {
  createRazorpayOrder,
  createStripeSession,
  decryptSecret,
  GatewayError,
  retrieveStripeSession,
  type Fetch,
  type GatewayCredentials,
  type StripeSession,
} from "@workeasy/payments";
import type { Trx } from "../routes/support.js";

/**
 * Card payments for the API: the store's gateway credentials (decrypted
 * only here, only for the call at hand), starting a payment for an order,
 * and confirming one from the shopper's return or the gateway's webhook.
 */
export interface PaymentsDeps {
  /** fetch for gateway calls; tests answer for the gateway. */
  fetch: Fetch;
  /** Unset: merchants can't connect gateways (the server has no key to encrypt them under). */
  secretsKey: Buffer | undefined;
}

export interface StoredCredentials extends GatewayCredentials {
  provider: GatewayProvider;
  mode: "test" | "live";
}

export async function credentialsFor(trx: Trx, payments: PaymentsDeps, provider: GatewayProvider): Promise<StoredCredentials | undefined> {
  if (!payments.secretsKey) return undefined;
  const account = await moneyRepo.accountSecrets(trx, provider);
  if (!account) return undefined;
  try {
    return {
      provider,
      mode: account.mode,
      publicKey: account.publicKey,
      secretKey: decryptSecret(account.secretKeyEnc, payments.secretsKey),
      webhookSecret: decryptSecret(account.webhookSecretEnc, payments.secretsKey),
    };
  } catch {
    // Saved under a different SECRETS_ENCRYPTION_KEY: unusable until the merchant re-enters the keys.
    return undefined;
  }
}

/** What the storefront needs to take the payment: Razorpay Checkout's options, or Stripe's hosted page. */
export type PaymentStart =
  | { provider: "razorpay"; keyId: string; razorpayOrderId: string; amountMinor: number; currency: string; storeName: string; description: string; prefill: { name: string; email: string; contact: string | null } }
  | { provider: "stripe"; url: string };

export interface PayContext {
  db: Db;
  payments: PaymentsDeps;
  store: { id: string; slug: string; name: string };
  storefrontOrigin: string;
}

function orderLabel(order: Order, storeName: string): string {
  return `Order #${order.number} · ${storeName}`;
}

/**
 * Starts (or resumes) paying for a card order. An open Razorpay order or
 * Stripe session is reused, so reloading the page doesn't create a second
 * one; a Stripe session that already completed is confirmed instead.
 */
export async function startPayment(ctx: PayContext, order: Order, token: string): Promise<PaymentStart | { paid: true } | { unavailable: true }> {
  const { db, payments, store } = ctx;
  const prep = await withStore(db, store.id, async (trx) => {
    const provider = await moneyRepo.cardGateway(trx, order.currency);
    const creds = provider ? await credentialsFor(trx, payments, provider) : undefined;
    return { creds, open: await moneyRepo.pendingGatewayPayment(trx, order.id) };
  });
  const { creds } = prep;
  if (!creds) return { unavailable: true };
  let open = prep.open?.provider === creds.provider ? prep.open : undefined;

  if (open && creds.provider === "stripe" && open.providerRef) {
    const session = await retrieveStripeSession(payments.fetch, creds, open.providerRef);
    if (await settleStripeSession(db, store.id, session)) return { paid: true };
    if (session.status === "open" && session.url) return { provider: "stripe", url: session.url };
    await withStore(db, store.id, (trx) => moneyRepo.failGatewayPayment(trx, store.id, open!.id, "checkout expired"));
    open = undefined;
  }

  if (creds.provider === "razorpay") {
    const razorpayOrderId =
      open?.providerRef ??
      (await (async () => {
        const rzp = await createRazorpayOrder(payments.fetch, creds, { amountMinor: order.totalMinor, currency: order.currency, receipt: `#${order.number}`, orderId: order.id });
        await withStore(db, store.id, (trx) =>
          moneyRepo.createPayment(trx, { storeId: store.id, orderId: order.id, provider: "razorpay", providerRef: rzp.id, amountMinor: order.totalMinor, currency: order.currency, mode: creds.mode }),
        );
        return rzp.id;
      })());
    return {
      provider: "razorpay",
      keyId: creds.publicKey,
      razorpayOrderId,
      amountMinor: order.totalMinor,
      currency: order.currency,
      storeName: store.name,
      description: orderLabel(order, store.name),
      prefill: { name: order.name, email: order.email, contact: order.phone },
    };
  }

  const orderUrl = new URL(`/s/${store.slug}/order/${token}`, ctx.storefrontOrigin);
  const session = await createStripeSession(payments.fetch, creds, {
    amountMinor: order.totalMinor,
    currency: order.currency,
    orderId: order.id,
    orderLabel: orderLabel(order, store.name),
    email: order.email,
    // Stripe fills in the session id; the order page checks it on return.
    successUrl: `${orderUrl.toString()}?paid=stripe`,
    cancelUrl: `${orderUrl.toString()}?paid=cancelled`,
    attemptKey: randomUUID(),
  });
  if (!session.url) throw new GatewayError("stripe_no_url", true);
  await withStore(db, store.id, (trx) =>
    moneyRepo.createPayment(trx, { storeId: store.id, orderId: order.id, provider: "stripe", providerRef: session.id, amountMinor: order.totalMinor, currency: order.currency, mode: creds.mode }),
  );
  return { provider: "stripe", url: session.url };
}

/** Confirms a Stripe session that's paid; true when the order is (now or already) paid by it. */
export async function settleStripeSession(db: Db, storeId: string, session: StripeSession): Promise<boolean> {
  const result = await withStore(db, storeId, (trx) => settleStripeSessionIn(trx, storeId, session));
  return result === "paid" || result === "already";
}

/** settleStripeSession in the caller's transaction; undefined when the session isn't paid or isn't ours. */
export async function settleStripeSessionIn(trx: Trx, storeId: string, session: StripeSession) {
  if (session.payment_status !== "paid" || session.amount_total === null) return undefined;
  const payment = await moneyRepo.paymentByRef(trx, "stripe", session.id);
  if (!payment) return undefined;
  return moneyRepo.confirmGatewayPayment(trx, {
    storeId,
    paymentId: payment.id,
    providerPaymentId: session.payment_intent ?? session.id,
    amountMinor: session.amount_total,
    method: "card",
  });
}

/** For the shopper's return from Stripe: re-reads the order's open session and confirms it if paid. */
export async function refreshStripePayment(ctx: Pick<PayContext, "db" | "payments">, storeId: string, orderId: string): Promise<void> {
  const found = await withStore(ctx.db, storeId, async (trx) => {
    const open = await moneyRepo.pendingGatewayPayment(trx, orderId);
    if (!open || open.provider !== "stripe" || !open.providerRef) return undefined;
    const creds = await credentialsFor(trx, ctx.payments, "stripe");
    return creds ? { creds, ref: open.providerRef } : undefined;
  });
  if (!found) return;
  try {
    await settleStripeSession(ctx.db, storeId, await retrieveStripeSession(ctx.payments.fetch, found.creds, found.ref));
  } catch (err) {
    // The webhook confirms it anyway; the page just shows "awaiting payment" a little longer.
    if (!(err instanceof GatewayError)) throw err;
  }
}
