import type { Router } from "express";
import { toCsv, toDecimalString } from "@workeasy/commerce";
import { analyticsRepo, auditRepo, reviewsRepo, storesRepo, type Review } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { AnalyticsQuerySchema, ReviewListQuerySchema, ReviewPatchBodySchema, ReviewSettingsBodySchema } from "../contract/engagement.js";
import { problems } from "../http/problem.js";
import { actorOf, issuesToErrors, respond, UUID_PATTERN, type StoreAccess, type Trx } from "./support.js";

const PAGE_SIZE = 25;

function reviewJson(r: Review) {
  return { ...r, repliedAt: r.repliedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
}

const sum = <T>(rows: readonly T[], key: (r: T) => number) => rows.reduce((n, r) => n + key(r), 0);

/**
 * The analytics report for the last `days` days in the store's time zone,
 * with the period before for comparison. Rollups for the window are
 * refreshed first, so the numbers include the last few minutes.
 */
async function report(trx: Trx, storeId: string, days: number) {
  const store = (await storesRepo.getStore(trx))!;
  const tz = store.timezone;
  await analyticsRepo.rollupRecent(trx, storeId, tz, Math.min(days * 2, 180));
  const to = analyticsRepo.today(tz);
  const from = analyticsRepo.addDays(to, -(days - 1));
  const prevTo = analyticsRepo.addDays(from, -1);
  const prevFrom = analyticsRepo.addDays(prevTo, -(days - 1));
  const [series, previous, sources, top, mix] = await Promise.all([
    analyticsRepo.dailySeries(trx, from, to),
    analyticsRepo.dailySeries(trx, prevFrom, prevTo),
    analyticsRepo.sources(trx, from, to),
    analyticsRepo.topProducts(trx, from, to, tz, 10),
    analyticsRepo.customerMix(trx, from, to, tz),
  ]);
  const totals = (rows: typeof series) => {
    const revenue = sum(rows, (r) => r.revenueMinor);
    const orders = sum(rows, (r) => r.orders);
    const visitors = sum(rows, (r) => r.visitors);
    return {
      revenueMinor: revenue,
      orders,
      averageOrderMinor: orders ? Math.round(revenue / orders) : 0,
      visitors,
      pageViews: sum(rows, (r) => r.pageViews),
      // Orders per visitor; null without visitors (e.g. before tracking began).
      conversionRate: visitors ? orders / visitors : null,
      mobileShare: visitors ? sum(rows, (r) => r.mobileVisitors) / visitors : null,
    };
  };
  return {
    from,
    to,
    timeZone: tz,
    currency: store.currency,
    series,
    totals: totals(series),
    previous: totals(previous),
    funnel: {
      visitors: sum(series, (r) => r.visitors),
      viewedProduct: sum(series, (r) => r.viewedProduct),
      addedToCart: sum(series, (r) => r.addedToCart),
      reachedCheckout: sum(series, (r) => r.reachedCheckout),
      orders: sum(series, (r) => r.orders),
    },
    sources,
    topProducts: top,
    customers: mix,
  };
}

/** Reviews moderation and settings, and the analytics report. */
export function engagementRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/reviews", async (req, res) => {
    const query = ReviewListQuerySchema.safeParse(req.query);
    if (!query.success) return problems.validation(res, issuesToErrors(query.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, ["reviews.manage", "analytics.read"], async (trx) => {
        const page = await reviewsRepo.listReviews(trx, { status: query.data.status, rating: query.data.rating, q: query.data.q, limit: PAGE_SIZE, offset: (query.data.page - 1) * PAGE_SIZE });
        return {
          kind: "ok",
          body: {
            items: page.items.map(reviewJson),
            total: page.total,
            page: query.data.page,
            pageSize: PAGE_SIZE,
            counts: await reviewsRepo.reviewCounts(trx),
            summary: await reviewsRepo.ratingSummary(trx),
          },
        };
      }),
    );
  });

  router.patch("/stores/:storeId/reviews/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    const body = ReviewPatchBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "reviews.manage", async (trx) => {
        if (!(await reviewsRepo.moderateReview(trx, req.params.id, body.data))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, {
          storeId: req.params.storeId,
          ...actorOf(res),
          action: body.data.reply !== undefined ? "review.replied" : `review.${body.data.status}`,
          resourceType: "review",
          resourceId: req.params.id,
        });
        const found = (await reviewsRepo.listReviews(trx, { id: req.params.id, limit: 1, offset: 0 })).items[0]!;
        return { kind: "ok", body: { review: reviewJson(found), counts: await reviewsRepo.reviewCounts(trx) } };
      }),
    );
  });

  router.delete("/stores/:storeId/reviews/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "reviews.manage", async (trx) => {
        if (!(await reviewsRepo.deleteReview(trx, req.params.id))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "review.deleted", resourceType: "review", resourceId: req.params.id });
        return { kind: "ok", body: { counts: await reviewsRepo.reviewCounts(trx) } };
      }),
    );
  });

  router.get("/stores/:storeId/review-settings", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, "reviews.manage", async (trx) => ({ kind: "ok", body: { settings: await reviewsRepo.getReviewSettings(trx) } })));
  });

  router.put("/stores/:storeId/review-settings", async (req, res) => {
    const body = ReviewSettingsBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "reviews.manage", async (trx) => {
        const settings = await reviewsRepo.saveReviewSettings(trx, req.params.storeId, body.data);
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "reviews.settings_updated", resourceType: "store", resourceId: req.params.storeId, metadata: { ...settings } });
        return { kind: "ok", body: { settings } };
      }),
    );
  });

  router.get("/stores/:storeId/analytics", async (req, res) => {
    const query = AnalyticsQuerySchema.safeParse(req.query);
    if (!query.success) return problems.validation(res, issuesToErrors(query.error));
    respond(res, await withPermission(res, req.params.storeId, "analytics.read", async (trx) => ({ kind: "ok", body: await report(trx, req.params.storeId, query.data.days) })));
  });

  /** The daily numbers as CSV, for spreadsheets. */
  router.get("/stores/:storeId/analytics.csv", async (req, res) => {
    const query = AnalyticsQuerySchema.safeParse(req.query);
    if (!query.success) return problems.validation(res, issuesToErrors(query.error));
    const out = await withPermission(res, req.params.storeId, "analytics.read", async (trx) => ({ kind: "ok", body: await report(trx, req.params.storeId, query.data.days) }));
    if (typeof out === "symbol" || out.kind !== "ok") return respond(res, out);
    const r = out.body;
    const csv = toCsv([
      ["Date", "Visitors", "Page views", "Product views", "Added to cart", "Reached checkout", "Orders", `Revenue (${r.currency})`, "Mobile visitors"],
      ...r.series.map((d) => [d.day, String(d.visitors), String(d.pageViews), String(d.productViews), String(d.addedToCart), String(d.reachedCheckout), String(d.orders), toDecimalString(d.revenueMinor, r.currency), String(d.mobileVisitors)]),
    ]);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analytics-${r.from}-to-${r.to}.csv"` });
    res.status(200).send(csv);
  });
}

export { report as analyticsReport };
