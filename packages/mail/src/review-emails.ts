import { ordersRepo, reviewsRepo, withStore } from "@workeasy/database";
import { PermanentJobError, RetryLaterError, type JobDefinition } from "@workeasy/jobs";
import { headerSafe } from "./mailer.js";
import type { OrderEmailDeps } from "./order-emails.js";

/**
 * The reviews.request job: a few days after an order is fully fulfilled (as
 * many as the store chose), the buyer gets a link to review what they
 * bought. The link is its own secret, separate from the order link.
 */
export const REVIEW_REQUEST_JOB = "reviews.request";

export function reviewEmail(input: { name: string; storeName: string; number: number; titles: string[]; url: string }): { subject: string; text: string } {
  const first = input.name.trim().split(/\s+/)[0] ?? "there";
  const text = [
    `Hi ${first},`,
    "",
    `How are you finding your order #${input.number} from ${input.storeName}?`,
    "",
    ...input.titles.map((t) => `  • ${t}`),
    "",
    "A quick star rating helps other shoppers, and the shop, a lot:",
    input.url,
    "",
    "The link works for 60 days.",
    "",
    `— ${input.storeName}`,
  ].join("\n");
  return { subject: headerSafe(`How was your order from ${input.storeName}?`), text };
}

export function reviewRequestJob(deps: OrderEmailDeps): JobDefinition {
  return {
    events: [reviewsRepo.REVIEW_REQUESTED_V1],
    async handle(ctx) {
      const data = (ctx.payload.data ?? {}) as { orderId?: unknown };
      if (typeof data.orderId !== "string") throw new PermanentJobError("bad_payload");
      const orderId = data.orderId;
      const state = await withStore(deps.workerDb, ctx.storeId, async (trx) => {
        const found = await ordersRepo.getOrderWithItems(trx, orderId);
        const settings = await reviewsRepo.getReviewSettings(trx);
        const store = await trx.selectFrom("stores").select(["name", "slug"]).executeTakeFirst();
        const fulfilled = await trx.selectFrom("orders").select("fulfilled_at").where("id", "=", orderId).executeTakeFirst();
        return found && store ? { ...found, settings, store, fulfilledAt: fulfilled?.fulfilled_at ?? null } : undefined;
      });
      if (!state) throw new PermanentJobError("order_missing");
      const { order, items, settings, store, fulfilledAt } = state;
      // The store turned requests off, or the order was cancelled or refunded since.
      if (settings.requestAfterDays === null || order.status !== "open" || order.paymentStatus === "refunded" || !fulfilledAt) return;
      const due = fulfilledAt.getTime() + settings.requestAfterDays * 86_400_000;
      if (Date.now() < due) throw new RetryLaterError("not_due", due - Date.now());
      if (!deps.mailer) throw new PermanentJobError("email_not_configured");

      const token = await withStore(deps.workerDb, ctx.storeId, (trx) => reviewsRepo.createReviewRequest(trx, ctx.storeId, orderId));
      const url = new URL(`/s/${store.slug}/review/${token}`, deps.storefrontUrl).toString();
      const titles = [...new Set(items.filter((i) => i.productId).map((i) => i.title))];
      if (titles.length === 0) return;
      const m = reviewEmail({ name: order.name, storeName: store.name, number: order.number, titles, url });
      const result = await deps.mailer.send({ to: [order.email], subject: m.subject, text: m.text, messageId: `<${ctx.dedupeKey}.review@orders.workeasy360>` });
      if (!result.ok) {
        deps.log?.("warn", "review email not accepted", { orderId, code: result.code });
        if (result.retryable) throw new RetryLaterError(result.code, 60_000);
        throw new PermanentJobError(result.code);
      }
      await withStore(deps.workerDb, ctx.storeId, (trx) =>
        trx.insertInto("order_events").values({ store_id: ctx.storeId, order_id: orderId, kind: "email_sent", message: "Review request emailed to the customer" }).execute(),
      );
    },
  };
}
