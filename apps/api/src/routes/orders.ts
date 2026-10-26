import type { Router } from "express";
import { auditRepo, checkoutRepo, moneyRepo, ordersRepo, storesRepo, type Order, type OrderItem } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { CancelOrderBodySchema, CheckoutSettingsBodySchema, OrderListQuerySchema, OrderNoteBodySchema } from "../contract/orders.js";
import { problems } from "../http/problem.js";
import { actorOf, decodeCursor, encodeCursor, invalid, issuesToErrors, respond, UUID_PATTERN, type Failure, type StoreAccess, type Trx } from "./support.js";

export function orderJson(o: Order) {
  return {
    ...o,
    paymentDueAt: o.paymentDueAt?.toISOString() ?? null,
    placedAt: o.placedAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    fulfilledAt: o.fulfilledAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
  };
}

function itemJson(i: OrderItem) {
  return { ...i, bookingAt: i.bookingAt?.toISOString() ?? null };
}

const iso = <T extends { createdAt: Date }>(x: T) => ({ ...x, createdAt: x.createdAt.toISOString() });

/** The full order for the admin: items, timeline, payments, refunds, shipments and what's left to refund or ship. */
export async function orderDetail(trx: Trx, orderId: string) {
  const found = await ordersRepo.getOrder(trx, orderId);
  if (!found) return undefined;
  const remaining = await ordersRepo.unfulfilledQuantities(trx, orderId);
  const money = await moneyRepo.refundable(trx, orderId);
  return {
    order: orderJson(found.order),
    items: found.items.map((i) => ({ ...itemJson(i), unfulfilledQuantity: remaining.get(i.id) ?? 0 })),
    events: found.events.map(iso),
    payments: (await moneyRepo.orderPayments(trx, orderId)).map(iso),
    refunds: (await moneyRepo.orderRefunds(trx, orderId)).map(iso),
    fulfillments: (await ordersRepo.listFulfillments(trx, orderId)).map(iso),
    refundableMinor: money?.availableMinor ?? 0,
  };
}

const NOT_ALLOWED = { kind: "conflict", code: "ORDER_STATE", title: "The order has changed. Reload to see its current state" } as const;

/**
 * Orders (merchant side) and the checkout settings shoppers order under.
 * Refunds, shipments and invoices are in money.ts.
 */
export function ordersRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/checkout-settings", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, ["settings.manage", "orders.read"], async (trx) => ({ kind: "ok", body: { settings: await checkoutRepo.getCheckoutSettings(trx) } })),
    );
  });

  router.put("/stores/:storeId/checkout-settings", async (req, res) => {
    const body = CheckoutSettingsBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const s = body.data;
    respond(
      res,
      await withPermission(res, req.params.storeId, "settings.manage", async (trx) => {
        const store = (await storesRepo.getStore(trx))!;
        if (!s.codEnabled && !s.bankEnabled && !s.upiEnabled && !s.whatsappNumber && !s.telegramUsername && !(await moneyRepo.cardGateway(trx, store.currency))) {
          return invalid("codEnabled", "Turn on at least one way to pay or order");
        }
        const saved = await checkoutRepo.saveCheckoutSettings(trx, req.params.storeId, body.data);
        await auditRepo.appendAudit(trx, {
          storeId: req.params.storeId,
          ...actorOf(res),
          action: "checkout.updated",
          resourceType: "store",
          resourceId: req.params.storeId,
          metadata: { paymentMethods: checkoutRepo.enabledPaymentMethods(saved) },
        });
        return { kind: "ok", body: { settings: saved } };
      }),
    );
  });

  router.get("/stores/:storeId/orders", async (req, res) => {
    const query = OrderListQuerySchema.safeParse(req.query);
    if (!query.success) {
      problems.validation(res, issuesToErrors(query.error));
      return;
    }
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;
    if (query.data.cursor && (!cursor || Number.isNaN(Date.parse(cursor.at)))) {
      problems.validation(res, [{ field: "cursor", code: "INVALID", message: "Invalid cursor" }]);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "orders.read", async (trx) => {
        const page = await ordersRepo.listOrders(trx, { tab: query.data.tab, q: query.data.q, limit: query.data.limit, after: cursor ? { placedAt: cursor.at, id: cursor.id } : undefined });
        const last = page.items.at(-1);
        return {
          kind: "ok",
          body: {
            items: page.items.map(({ placedAtKey: _key, ...o }) => ({ ...o, placedAt: o.placedAt.toISOString() })),
            counts: await ordersRepo.orderCounts(trx),
            ...(page.more && last ? { nextCursor: encodeCursor({ at: last.placedAtKey, id: last.id }) } : {}),
          },
        };
      }),
    );
  });

  router.get("/stores/:storeId/orders/:orderId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.orderId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "orders.read", async (trx) => {
        const detail = await orderDetail(trx, req.params.orderId);
        return detail ? { kind: "ok", body: detail } : { kind: "not_found" };
      }),
    );
  });

  /** One action route per change, so each is a single, audited step. */
  const action = (path: string, audit: string, run: (trx: Parameters<Parameters<StoreAccess["withPermission"]>[3]>[0], storeId: string, orderId: string, userId: string, body: unknown) => Promise<ordersRepo.ActionResult | Failure>) =>
    router.post(`/stores/:storeId/orders/:orderId/${path}`, async (req, res) => {
      if (!UUID_PATTERN.test(req.params.orderId)) {
        problems.notFound(res);
        return;
      }
      respond(
        res,
        await withPermission(res, req.params.storeId, "orders.manage", async (trx, _m, userId) => {
          const result = await run(trx, req.params.storeId, req.params.orderId, userId, req.body ?? {});
          if (typeof result !== "string") return result;
          if (result === "not_found") return { kind: "not_found" };
          if (result === "not_allowed") return NOT_ALLOWED;
          await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: audit, resourceType: "order", resourceId: req.params.orderId });
          return { kind: "ok", body: (await orderDetail(trx, req.params.orderId))! };
        }),
      );
    });

  action("paid", "order.paid", async (trx, storeId, id, userId) => {
    const result = await ordersRepo.markPaid(trx, storeId, id, userId);
    if (result === "done") {
      // Offline takings join the finance ledger alongside card payments.
      const o = (await ordersRepo.getOrder(trx, id))!.order;
      await moneyRepo.recordManualPayment(trx, storeId, id, o.totalMinor, o.currency, o.paymentMethod);
    }
    return result;
  });
  action("fulfilled", "order.fulfilled", (trx, storeId, id, userId) => ordersRepo.markFulfilled(trx, storeId, id, userId));
  action("cancel", "order.cancelled", async (trx, storeId, id, userId, raw) => {
    const body = CancelOrderBodySchema.safeParse(raw);
    if (!body.success) return { kind: "invalid", errors: issuesToErrors(body.error) };
    return ordersRepo.cancelOrder(trx, storeId, id, userId, body.data.restock);
  });
  action("notes", "order.noted", async (trx, storeId, id, userId, raw) => {
    const body = OrderNoteBodySchema.safeParse(raw);
    if (!body.success) return { kind: "invalid", errors: issuesToErrors(body.error) };
    return ordersRepo.addNote(trx, storeId, id, userId, body.data.note);
  });

  /** Last 30 days for the dashboard, in the store's time zone. */
  router.get("/stores/:storeId/sales-summary", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, ["orders.read", "analytics.read"], async (trx) => {
        const store = (await storesRepo.getStore(trx))!;
        const since = new Date(Date.now() - 30 * 86_400_000);
        const summary = await ordersRepo.salesSummary(trx, since, store.timezone);
        const recent = await ordersRepo.listOrders(trx, { tab: "all", limit: 5 });
        return {
          kind: "ok",
          body: {
            ...summary,
            since: since.toISOString(),
            recent: recent.items.map(({ placedAtKey: _key, ...o }) => ({ ...o, placedAt: o.placedAt.toISOString() })),
          },
        };
      }),
    );
  });
}
