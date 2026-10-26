import { formatMoney } from "@workeasy/commerce";
import { sql, type Selectable, type Transaction } from "kysely";
import type { CheckoutsTable, Database, GatewayProvider, PaymentAccountsTable } from "../schema.js";
import { recordMovement } from "./inventory.js";
import { withStore } from "../context.js";
import type { Db } from "../client.js";
import { addEvent, cancelOrder } from "./orders.js";
import { grantDownloads, revokeDownloads } from "./rules.js";

/**
 * Money: connected card gateways, payments, refunds and the finance ledger;
 * plus customers and abandoned checkouts. All in the caller's store-scoped
 * transaction. Gateway secrets arrive and leave encrypted; this module never
 * sees them in plain text.
 */
type Trx = Transaction<Database>;

// Payment accounts ---------------------------------------------------------------------------

export interface PaymentAccount {
  provider: GatewayProvider;
  mode: "test" | "live";
  publicKey: string;
  secretKeyHint: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toAccount(r: Selectable<PaymentAccountsTable>): PaymentAccount {
  return { provider: r.provider, mode: r.mode, publicKey: r.public_key, secretKeyHint: r.secret_key_hint, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listAccounts(trx: Trx): Promise<PaymentAccount[]> {
  return (await trx.selectFrom("payment_accounts").selectAll().orderBy("provider").execute()).map(toAccount);
}

/** The account with its encrypted secrets, for the API to decrypt and use. */
export async function accountSecrets(trx: Trx, provider: GatewayProvider): Promise<(PaymentAccount & { secretKeyEnc: string; webhookSecretEnc: string }) | undefined> {
  const r = await trx.selectFrom("payment_accounts").selectAll().where("provider", "=", provider).executeTakeFirst();
  return r ? { ...toAccount(r), secretKeyEnc: r.secret_key_enc, webhookSecretEnc: r.webhook_secret_enc } : undefined;
}

export interface AccountInput {
  provider: GatewayProvider;
  mode: "test" | "live";
  publicKey: string;
  secretKeyEnc: string;
  webhookSecretEnc: string;
  secretKeyHint: string;
  enabled: boolean;
  connectedBy: string;
}

export async function saveAccount(trx: Trx, storeId: string, a: AccountInput): Promise<PaymentAccount> {
  const values = {
    mode: a.mode,
    public_key: a.publicKey,
    secret_key_enc: a.secretKeyEnc,
    webhook_secret_enc: a.webhookSecretEnc,
    secret_key_hint: a.secretKeyHint,
    enabled: a.enabled,
    connected_by: a.connectedBy,
  };
  const row = await trx
    .insertInto("payment_accounts")
    .values({ store_id: storeId, provider: a.provider, ...values })
    .onConflict((oc) => oc.columns(["store_id", "provider"]).doUpdateSet(values))
    .returningAll()
    .executeTakeFirstOrThrow();
  return toAccount(row);
}

export async function deleteAccount(trx: Trx, provider: GatewayProvider): Promise<boolean> {
  const r = await trx.deleteFrom("payment_accounts").where("provider", "=", provider).executeTakeFirst();
  return Number(r.numDeletedRows) > 0;
}

/** The gateway card payments go through: Razorpay for rupees when connected, otherwise Stripe. */
export async function cardGateway(trx: Trx, currency: string): Promise<GatewayProvider | undefined> {
  const enabled = (await trx.selectFrom("payment_accounts").select("provider").where("enabled", "=", true).execute()).map((r) => r.provider);
  if (enabled.includes("razorpay") && (currency === "INR" || !enabled.includes("stripe"))) return "razorpay";
  if (enabled.includes("stripe")) return "stripe";
  return undefined;
}

// Payments -----------------------------------------------------------------------------------

export interface Payment {
  id: string;
  orderId: string;
  provider: GatewayProvider | "manual";
  providerRef: string | null;
  providerPaymentId: string | null;
  status: "created" | "succeeded" | "failed";
  method: string | null;
  amountMinor: number;
  currency: string;
  mode: "test" | "live";
  createdAt: Date;
}

const paymentCols = ["id", "order_id", "provider", "provider_ref", "provider_payment_id", "status", "method", "amount_minor", "currency", "mode", "created_at"] as const;
type PaymentRow = { id: string; order_id: string; provider: GatewayProvider | "manual"; provider_ref: string | null; provider_payment_id: string | null; status: Payment["status"]; method: string | null; amount_minor: string; currency: string; mode: "test" | "live"; created_at: Date };

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    orderId: r.order_id,
    provider: r.provider,
    providerRef: r.provider_ref,
    providerPaymentId: r.provider_payment_id,
    status: r.status,
    method: r.method,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    mode: r.mode,
    createdAt: r.created_at,
  };
}

export async function createPayment(
  trx: Trx,
  input: { storeId: string; orderId: string; provider: GatewayProvider; providerRef: string; amountMinor: number; currency: string; mode: "test" | "live" },
): Promise<Payment> {
  const row = await trx
    .insertInto("payments")
    .values({ store_id: input.storeId, order_id: input.orderId, provider: input.provider, provider_ref: input.providerRef, amount_minor: input.amountMinor, currency: input.currency, mode: input.mode })
    .returning(paymentCols)
    .executeTakeFirstOrThrow();
  return toPayment(row);
}

export async function paymentByRef(trx: Trx, provider: GatewayProvider, providerRef: string): Promise<Payment | undefined> {
  const row = await trx.selectFrom("payments").select(paymentCols).where("provider", "=", provider).where("provider_ref", "=", providerRef).executeTakeFirst();
  return row ? toPayment(row) : undefined;
}

export async function orderPayments(trx: Trx, orderId: string): Promise<Payment[]> {
  return (await trx.selectFrom("payments").select(paymentCols).where("order_id", "=", orderId).orderBy("created_at").execute()).map(toPayment);
}

/** The order's open gateway payment, if a shopper started paying. */
export async function pendingGatewayPayment(trx: Trx, orderId: string): Promise<Payment | undefined> {
  const row = await trx.selectFrom("payments").select(paymentCols).where("order_id", "=", orderId).where("status", "=", "created").where("provider", "!=", "manual").orderBy("created_at", "desc").executeTakeFirst();
  return row ? toPayment(row) : undefined;
}

const PROVIDER_NAME = { razorpay: "Razorpay", stripe: "Stripe" } as const;

/**
 * A gateway confirmed a payment. Records it once (repeat confirmations from
 * the browser and webhooks are no-ops), marks the order paid, and emails the
 * order confirmation. Amounts that don't match the order are refused.
 */
export async function confirmGatewayPayment(
  trx: Trx,
  input: { storeId: string; paymentId: string; providerPaymentId: string; amountMinor: number; method: string | null; accessToken?: string | undefined },
): Promise<"paid" | "already" | "amount_mismatch" | "order_closed" | "not_found"> {
  const payment = await trx.selectFrom("payments").select(paymentCols).where("id", "=", input.paymentId).forUpdate().executeTakeFirst();
  if (!payment) return "not_found";
  if (payment.status === "succeeded") return "already";
  if (Number(payment.amount_minor) !== input.amountMinor) return "amount_mismatch";
  await trx
    .updateTable("payments")
    .set({ status: "succeeded", provider_payment_id: input.providerPaymentId, method: input.method?.slice(0, 50) ?? null })
    .where("id", "=", payment.id)
    .execute();
  const order = await trx
    .updateTable("orders")
    .set({ payment_status: "paid", paid_at: sql<Date>`now()`, payment_due_at: null })
    .where("id", "=", payment.order_id)
    .where("payment_status", "=", "pending")
    .where("status", "=", "open")
    .returning(["id", "number"])
    .executeTakeFirst();
  if (!order) return "order_closed";
  const via = `${PROVIDER_NAME[payment.provider as GatewayProvider]}${input.method ? ` (${input.method})` : ""}`;
  await addEvent(trx, input.storeId, order.id, "paid", `Paid online via ${via}${payment.mode === "test" ? " · test mode" : ""}`, null);
  await grantDownloads(trx, input.storeId, order.id);
  return "paid";
}

export async function failGatewayPayment(trx: Trx, storeId: string, paymentId: string, reason: string): Promise<void> {
  const row = await trx.updateTable("payments").set({ status: "failed" }).where("id", "=", paymentId).where("status", "=", "created").returning("order_id").executeTakeFirst();
  if (row) await addEvent(trx, storeId, row.order_id, "payment_failed", `Online payment failed (${reason})`, null);
}

/** Records an offline payment (cash, UPI, bank transfer) as a manual payment, for the ledger. */
export async function recordManualPayment(trx: Trx, storeId: string, orderId: string, amountMinor: number, currency: string, method: string): Promise<void> {
  await trx.insertInto("payments").values({ store_id: storeId, order_id: orderId, provider: "manual", status: "succeeded", method, amount_minor: amountMinor, currency }).execute();
}

// Refunds ------------------------------------------------------------------------------------

export interface Refund {
  id: string;
  orderId: string;
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  reason: string | null;
  providerRefundId: string | null;
  status: "pending" | "succeeded" | "failed";
  failureCode: string | null;
  restocked: boolean;
  createdBy: string;
  createdAt: Date;
}

export async function orderRefunds(trx: Trx, orderId: string): Promise<Refund[]> {
  const rows = await trx.selectFrom("refunds").selectAll().where("order_id", "=", orderId).orderBy("created_at").execute();
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    paymentId: r.payment_id,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    reason: r.reason,
    providerRefundId: r.provider_refund_id,
    status: r.status,
    failureCode: r.failure_code,
    restocked: r.restocked,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

/** How much more can be refunded on an order: what was paid minus refunds that didn't fail. */
export async function refundable(trx: Trx, orderId: string): Promise<{ paidMinor: number; refundedMinor: number; availableMinor: number; currency: string } | undefined> {
  const o = await trx.selectFrom("orders").select(["total_minor", "payment_status", "currency"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
  if (!o) return undefined;
  const r = await trx
    .selectFrom("refunds")
    .select(sql<string>`coalesce(sum(amount_minor), 0)`.as("n"))
    .where("order_id", "=", orderId)
    .where("status", "!=", "failed")
    .executeTakeFirstOrThrow();
  const paid = o.payment_status === "pending" ? 0 : Number(o.total_minor);
  const refunded = Number(r.n);
  return { paidMinor: paid, refundedMinor: refunded, availableMinor: Math.max(0, paid - refunded), currency: o.currency };
}

/**
 * Starts a refund: records it (pending for a gateway, succeeded for money
 * returned outside), updates the order's refunded total and status, and puts
 * stock back when asked. The caller sends gateway refunds and settles them
 * with settleRefund.
 */
export async function createRefund(
  trx: Trx,
  input: {
    storeId: string;
    orderId: string;
    amountMinor: number;
    reason: string | null;
    paymentId: string | null;
    actorId: string;
    restock: Array<{ orderItemId: string; quantity: number }>;
  },
): Promise<{ kind: "created"; refundId: string } | { kind: "too_much"; availableMinor: number } | { kind: "not_paid" } | { kind: "not_found" }> {
  const money = await refundable(trx, input.orderId);
  if (!money) return { kind: "not_found" };
  if (money.paidMinor === 0) return { kind: "not_paid" };
  if (input.amountMinor > money.availableMinor) return { kind: "too_much", availableMinor: money.availableMinor };
  const refund = await trx
    .insertInto("refunds")
    .values({
      store_id: input.storeId,
      order_id: input.orderId,
      payment_id: input.paymentId,
      amount_minor: input.amountMinor,
      currency: money.currency,
      reason: input.reason,
      status: input.paymentId ? "pending" : "succeeded",
      restocked: input.restock.length > 0,
      created_by: input.actorId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const refundedNow = money.refundedMinor + input.amountMinor;
  await trx
    .updateTable("orders")
    .set({ refunded_minor: refundedNow, payment_status: refundedNow >= money.paidMinor ? "refunded" : "partially_refunded" })
    .where("id", "=", input.orderId)
    .execute();
  // A full refund takes back the downloads that came with the order.
  if (refundedNow >= money.paidMinor) await revokeDownloads(trx, input.orderId);
  const order = await trx.selectFrom("orders").select("number").where("id", "=", input.orderId).executeTakeFirstOrThrow();
  let units = 0;
  for (const r of input.restock) {
    const item = await trx.selectFrom("order_items").select(["variant_id", "quantity"]).where("id", "=", r.orderItemId).where("order_id", "=", input.orderId).executeTakeFirst();
    if (!item?.variant_id || r.quantity < 1 || r.quantity > item.quantity) continue;
    await recordMovement(trx, { storeId: input.storeId, variantId: item.variant_id, delta: r.quantity, reason: "returned", note: `Refund on order #${order.number}`, actorId: input.actorId, orderId: input.orderId });
    units += r.quantity;
  }
  const how = input.paymentId ? "to the card" : "outside the store (cash, UPI or bank)";
  await addEvent(trx, input.storeId, input.orderId, "refunded", `Refund of ${formatMoney(input.amountMinor, money.currency, "en-IN", { compact: true })} ${how}${units ? `; ${units} item${units === 1 ? "" : "s"} back in stock` : ""}${input.reason ? `: ${input.reason}` : ""}`, input.actorId);
  return { kind: "created", refundId: refund.id };
}

/**
 * Settles a gateway refund. A failed refund no longer counts towards the
 * order's refunded total, so it can be retried.
 */
export async function settleRefund(trx: Trx, storeId: string, refundId: string, result: { status: "pending" | "succeeded" | "failed"; providerRefundId?: string | null; failureCode?: string | null }): Promise<void> {
  const before = await trx.selectFrom("refunds").select(["status", "order_id", "amount_minor"]).where("id", "=", refundId).forUpdate().executeTakeFirst();
  if (!before || before.status !== "pending") return;
  await trx
    .updateTable("refunds")
    .set({ status: result.status, ...(result.providerRefundId ? { provider_refund_id: result.providerRefundId } : {}), failure_code: result.failureCode ?? null })
    .where("id", "=", refundId)
    .execute();
  if (result.status === "failed") {
    const o = await trx.selectFrom("orders").select(["refunded_minor"]).where("id", "=", before.order_id).forUpdate().executeTakeFirstOrThrow();
    const refunded = Math.max(0, Number(o.refunded_minor) - Number(before.amount_minor));
    await trx.updateTable("orders").set({ refunded_minor: refunded, payment_status: refunded === 0 ? "paid" : "partially_refunded" }).where("id", "=", before.order_id).execute();
    await addEvent(trx, storeId, before.order_id, "refunded", `Refund failed (${result.failureCode ?? "gateway error"}); you can try again`, null);
  }
}

export async function refundByProviderId(trx: Trx, providerRefundId: string): Promise<{ id: string } | undefined> {
  return trx.selectFrom("refunds").select("id").where("provider_refund_id", "=", providerRefundId).executeTakeFirst();
}

// Webhook de-duplication ----------------------------------------------------------------------

/** True the first time an event is seen; false for a redelivery. */
export async function firstDelivery(trx: Trx, storeId: string, provider: GatewayProvider, eventId: string, eventType: string): Promise<boolean> {
  const r = await trx
    .insertInto("webhook_events")
    .values({ store_id: storeId, provider, event_id: eventId.slice(0, 200), event_type: eventType.slice(0, 100) })
    .onConflict((oc) => oc.columns(["store_id", "provider", "event_id"]).doNothing())
    .returning("event_id")
    .executeTakeFirst();
  return r !== undefined;
}

// Finances -----------------------------------------------------------------------------------

export interface LedgerEntry {
  id: string;
  kind: "payment" | "refund";
  orderId: string;
  orderNumber: number;
  customer: string;
  provider: string;
  method: string | null;
  status: string;
  amountMinor: number;
  currency: string;
  mode: string;
  at: Date;
}

/** Payments and refunds, newest first. */
export async function ledger(trx: Trx, query: { limit: number; offset: number }): Promise<{ entries: LedgerEntry[]; more: boolean }> {
  const { rows } = await sql<{
    id: string;
    kind: "payment" | "refund";
    order_id: string;
    number: number;
    name: string;
    provider: string;
    method: string | null;
    status: string;
    amount_minor: string;
    currency: string;
    mode: string;
    at: Date;
  }>`
    SELECT * FROM (
      SELECT p.id, 'payment' AS kind, p.order_id, o.number, o.name, p.provider, p.method, p.status, p.amount_minor, p.currency, p.mode, p.created_at AS at
        FROM app.payments p JOIN app.orders o ON o.id = p.order_id
       WHERE p.status <> 'created'
      UNION ALL
      SELECT r.id, 'refund', r.order_id, o.number, o.name, coalesce(p.provider, 'manual'), NULL, r.status, r.amount_minor, r.currency, coalesce(p.mode, 'live'), r.created_at
        FROM app.refunds r JOIN app.orders o ON o.id = r.order_id LEFT JOIN app.payments p ON p.id = r.payment_id
    ) t
    ORDER BY at DESC, id DESC
    LIMIT ${query.limit + 1} OFFSET ${query.offset}`.execute(trx);
  return {
    entries: rows.slice(0, query.limit).map((r) => ({
      id: r.id,
      kind: r.kind,
      orderId: r.order_id,
      orderNumber: r.number,
      customer: r.name,
      provider: r.provider,
      method: r.method,
      status: r.status,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      mode: r.mode,
      at: r.at,
    })),
    more: rows.length > query.limit,
  };
}

/** Takings since a moment: collected, refunded and net, split by how shoppers paid. */
export async function financeSummary(trx: Trx, since: Date) {
  const collected = await trx
    .selectFrom("payments")
    .select(["provider", sql<string>`coalesce(sum(amount_minor), 0)`.as("total"), sql<number>`count(*)::int`.as("n")])
    .where("status", "=", "succeeded")
    .where("mode", "=", "live")
    .where("created_at", ">=", since)
    .groupBy("provider")
    .execute();
  const refunded = await trx
    .selectFrom("refunds")
    .select(sql<string>`coalesce(sum(amount_minor), 0)`.as("total"))
    .where("status", "!=", "failed")
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  const outstanding = await trx
    .selectFrom("orders")
    .select([sql<string>`coalesce(sum(total_minor), 0)`.as("total"), sql<number>`count(*)::int`.as("n")])
    .where("status", "=", "open")
    .where("payment_status", "=", "pending")
    .executeTakeFirstOrThrow();
  const byProvider = Object.fromEntries(collected.map((c) => [c.provider, { totalMinor: Number(c.total), count: c.n }]));
  const collectedMinor = collected.reduce((n, c) => n + Number(c.total), 0);
  return {
    collectedMinor,
    refundedMinor: Number(refunded.total),
    netMinor: collectedMinor - Number(refunded.total),
    outstandingMinor: Number(outstanding.total),
    outstandingOrders: outstanding.n,
    byProvider: byProvider as Partial<Record<"razorpay" | "stripe" | "manual", { totalMinor: number; count: number }>>,
  };
}

// Customers ----------------------------------------------------------------------------------

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  orders: number;
  spentMinor: number;
  lastOrderAt: Date | null;
  createdAt: Date;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listCustomers(trx: Trx, query: { q?: string | undefined; limit: number; offset: number }): Promise<{ items: CustomerSummary[]; total: number }> {
  let q = trx.selectFrom("customers as c");
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    q = q.where((eb) => eb.or([eb("c.name", "ilike", pattern), eb("c.email", "ilike", pattern), eb("c.phone", "ilike", pattern)]));
  }
  const total = await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "c.id",
      "c.name",
      "c.email",
      "c.phone",
      "c.created_at",
      sql<number>`(SELECT count(*)::int FROM app.orders o WHERE o.customer_id = c.id AND o.status = 'open')`.as("orders"),
      sql<string>`(SELECT coalesce(sum(o.total_minor - o.refunded_minor), 0) FROM app.orders o WHERE o.customer_id = c.id AND o.payment_status <> 'pending')`.as("spent"),
      sql<Date | null>`(SELECT max(o.placed_at) FROM app.orders o WHERE o.customer_id = c.id)`.as("last_order_at"),
    ])
    .orderBy(sql`(SELECT max(o.placed_at) FROM app.orders o WHERE o.customer_id = c.id) DESC NULLS LAST`)
    .orderBy("c.id")
    .limit(query.limit)
    .offset(query.offset)
    .execute();
  return {
    items: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, orders: r.orders, spentMinor: Number(r.spent), lastOrderAt: r.last_order_at, createdAt: r.created_at })),
    total: total.n,
  };
}

export async function getCustomer(trx: Trx, id: string): Promise<CustomerSummary | undefined> {
  const found = await trx.selectFrom("customers").select("email").where("id", "=", id).executeTakeFirst();
  if (!found) return undefined;
  return (await listCustomers(trx, { q: found.email, limit: 1, offset: 0 })).items.find((c) => c.id === id);
}

// Checkouts ----------------------------------------------------------------------------------

export interface CheckoutInput {
  id?: string | undefined;
  storeId: string;
  email: string;
  name: string | null;
  phone: string | null;
  items: unknown[];
  subtotalMinor: number;
  currency: string;
}

/** Saves what a shopper has at checkout; updates their earlier record when it's theirs and not yet an order. */
export async function saveCheckout(trx: Trx, c: CheckoutInput): Promise<string> {
  const values = { email: c.email, name: c.name, phone: c.phone, items: JSON.stringify(c.items) as unknown as unknown[], subtotal_minor: c.subtotalMinor, currency: c.currency };
  if (c.id) {
    const updated = await trx.updateTable("checkouts").set(values).where("id", "=", c.id).where("order_id", "is", null).returning("id").executeTakeFirst();
    if (updated) return updated.id;
  }
  const row = await trx.insertInto("checkouts").values({ store_id: c.storeId, ...values }).returning("id").executeTakeFirstOrThrow();
  return row.id;
}

export interface AbandonedCheckout {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  items: Array<{ title?: string; variantTitle?: string | null; quantity?: number }>;
  subtotalMinor: number;
  currency: string;
  updatedAt: Date;
}

/** Checkouts left idle (an hour by default) without becoming an order, newest first. */
export async function abandonedCheckouts(trx: Trx, { idleMs = 3_600_000, limit = 100 }: { idleMs?: number; limit?: number } = {}): Promise<AbandonedCheckout[]> {
  const rows = await trx
    .selectFrom("checkouts")
    .selectAll()
    .where("order_id", "is", null)
    .where("updated_at", "<=", new Date(Date.now() - idleMs))
    .orderBy("updated_at", "desc")
    .limit(limit)
    .execute();
  return rows.map((r: Selectable<CheckoutsTable>) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    items: r.items as AbandonedCheckout["items"],
    subtotalMinor: Number(r.subtotal_minor),
    currency: r.currency,
    updatedAt: r.updated_at,
  }));
}

// Expiring unpaid card orders -------------------------------------------------------------

/**
 * Cancels card orders whose payment window has passed, putting their stock
 * back and closing the open gateway payment. Runs as the worker: overdue
 * orders are found across stores, then each is cancelled in its own store's
 * context. A payment that lands at the same moment wins: the cancel only
 * touches orders still open and unpaid.
 */
export async function expireCardOrders(workerDb: Db, limit = 100): Promise<number> {
  const { rows } = await sql<{ store_id: string; order_id: string }>`SELECT * FROM app.overdue_card_orders(${limit})`.execute(workerDb);
  let cancelled = 0;
  for (const r of rows) {
    const done = await withStore(workerDb, r.store_id, async (trx) => {
      const order = await trx.selectFrom("orders").select("id").where("id", "=", r.order_id).where("payment_status", "=", "pending").where("status", "=", "open").forUpdate().executeTakeFirst();
      if (!order) return false;
      await trx.updateTable("payments").set({ status: "failed" }).where("order_id", "=", r.order_id).where("status", "=", "created").execute();
      await trx.updateTable("orders").set({ payment_due_at: null }).where("id", "=", r.order_id).execute();
      return (await cancelOrder(trx, r.store_id, r.order_id, null, true, "Cancelled: payment wasn't completed in time")) === "done";
    });
    if (done) cancelled += 1;
  }
  return cancelled;
}
