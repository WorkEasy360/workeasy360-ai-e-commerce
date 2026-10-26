import { sql, type Kysely, type Transaction } from "kysely";
import type { AnalyticsEventType, Database } from "../schema.js";

/**
 * Storefront analytics: anonymous events in, daily rollups out. Days are
 * calendar days in the store's time zone. Orders and revenue come from the
 * orders themselves, not from browser events, so they are exact.
 */
type Trx = Transaction<Database>;

export const EVENT_RETENTION_DAYS = 90;

export interface IncomingEvent {
  type: AnalyticsEventType;
  path: string | null;
  productId: string | null;
}

export async function recordEvents(trx: Trx, storeId: string, session: { id: string; source: string; device: "mobile" | "tablet" | "desktop" }, events: readonly IncomingEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  await trx
    .insertInto("analytics_events")
    .values(events.map((e) => ({ store_id: storeId, session_id: session.id, type: e.type, path: e.path, product_id: e.productId, source: session.source, device: session.device })))
    .execute();
  return events.length;
}

/**
 * Recomputes the rollups for the last `days` days (today included) in the
 * store's time zone. Idempotent: each day's rows are replaced.
 */
export async function rollupRecent(trx: Trx, storeId: string, timeZone: string, days = 7): Promise<void> {
  const tz = timeZone;
  const fromDay = sql<string>`((now() AT TIME ZONE ${tz})::date - ${days - 1}::int)`;
  const local = (col: string) => sql`(${sql.ref(col)} AT TIME ZONE ${tz})::date`;

  await trx.deleteFrom("analytics_daily").where("day", ">=", fromDay).execute();
  await trx.deleteFrom("analytics_sources_daily").where("day", ">=", fromDay).execute();
  await trx.deleteFrom("analytics_products_daily").where("day", ">=", fromDay).execute();

  await sql`
    INSERT INTO app.analytics_daily (store_id, day, visitors, page_views, product_views, viewed_product, added_to_cart, reached_checkout, orders, revenue_minor, mobile_visitors)
    SELECT ${storeId}::uuid, d.day,
           coalesce(e.visitors, 0), coalesce(e.page_views, 0), coalesce(e.product_views, 0), coalesce(e.viewed_product, 0),
           coalesce(e.added_to_cart, 0), coalesce(e.reached_checkout, 0), coalesce(o.orders, 0), coalesce(o.revenue, 0), coalesce(e.mobile_visitors, 0)
      FROM (
        SELECT ${local("created_at")} AS day FROM app.analytics_events WHERE created_at >= (${fromDay})::timestamp AT TIME ZONE ${tz} - interval '1 day'
        UNION
        SELECT ${local("placed_at")} FROM app.orders WHERE placed_at >= (${fromDay})::timestamp AT TIME ZONE ${tz} - interval '1 day'
      ) d
      LEFT JOIN (
        SELECT ${local("created_at")} AS day,
               count(DISTINCT session_id)::int AS visitors,
               count(*) FILTER (WHERE type = 'page_view')::int AS page_views,
               count(*) FILTER (WHERE type = 'product_view')::int AS product_views,
               count(DISTINCT session_id) FILTER (WHERE type = 'product_view')::int AS viewed_product,
               count(DISTINCT session_id) FILTER (WHERE type = 'add_to_cart')::int AS added_to_cart,
               count(DISTINCT session_id) FILTER (WHERE type = 'checkout_start')::int AS reached_checkout,
               count(DISTINCT session_id) FILTER (WHERE device = 'mobile')::int AS mobile_visitors
          FROM app.analytics_events GROUP BY 1
      ) e ON e.day = d.day
      LEFT JOIN (
        SELECT ${local("placed_at")} AS day,
               count(*) FILTER (WHERE status = 'open')::int AS orders,
               coalesce(sum(total_minor - refunded_minor) FILTER (WHERE status = 'open' AND payment_status <> 'pending'), 0)::bigint AS revenue
          FROM app.orders GROUP BY 1
      ) o ON o.day = d.day
     WHERE d.day >= ${fromDay}`.execute(trx);

  await sql`
    INSERT INTO app.analytics_sources_daily (store_id, day, source, visitors)
    SELECT ${storeId}::uuid, ${local("created_at")}, source, count(DISTINCT session_id)::int
      FROM app.analytics_events
     WHERE created_at >= (${fromDay})::timestamp AT TIME ZONE ${tz}
     GROUP BY 2, 3`.execute(trx);

  await sql`
    INSERT INTO app.analytics_products_daily (store_id, day, product_id, views, added_to_cart)
    SELECT ${storeId}::uuid, ${local("created_at")}, product_id,
           count(*) FILTER (WHERE type = 'product_view')::int, count(*) FILTER (WHERE type = 'add_to_cart')::int
      FROM app.analytics_events
     WHERE created_at >= (${fromDay})::timestamp AT TIME ZONE ${tz} AND product_id IS NOT NULL
     GROUP BY 2, 3`.execute(trx);
}

export interface DayRow {
  day: string;
  visitors: number;
  pageViews: number;
  productViews: number;
  viewedProduct: number;
  addedToCart: number;
  reachedCheckout: number;
  orders: number;
  revenueMinor: number;
  mobileVisitors: number;
}

const ZERO = { visitors: 0, pageViews: 0, productViews: 0, viewedProduct: 0, addedToCart: 0, reachedCheckout: 0, orders: 0, revenueMinor: 0, mobileVisitors: 0 };

/** Every day from `from` to `to` (inclusive, "YYYY-MM-DD"), days with no activity as zeros. */
export async function dailySeries(trx: Trx, from: string, to: string): Promise<DayRow[]> {
  const rows = await trx
    .selectFrom("analytics_daily")
    .select([
      sql<string>`day::text`.as("day"),
      "visitors",
      "page_views",
      "product_views",
      "viewed_product",
      "added_to_cart",
      "reached_checkout",
      "orders",
      "revenue_minor",
      "mobile_visitors",
    ])
    .where("day", ">=", from)
    .where("day", "<=", to)
    .execute();
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DayRow[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push(
      r
        ? {
            day,
            visitors: r.visitors,
            pageViews: r.page_views,
            productViews: r.product_views,
            viewedProduct: r.viewed_product,
            addedToCart: r.added_to_cart,
            reachedCheckout: r.reached_checkout,
            orders: r.orders,
            revenueMinor: Number(r.revenue_minor),
            mobileVisitors: r.mobile_visitors,
          }
        : { day, ...ZERO },
    );
  }
  return out;
}

export async function sources(trx: Trx, from: string, to: string): Promise<Array<{ source: string; visitors: number }>> {
  const rows = await trx
    .selectFrom("analytics_sources_daily")
    .select(["source", sql<number>`sum(visitors)::int`.as("visitors")])
    .where("day", ">=", from)
    .where("day", "<=", to)
    .groupBy("source")
    .orderBy("visitors", "desc")
    .execute();
  return rows;
}

export interface TopProduct {
  productId: string;
  title: string;
  views: number;
  addedToCart: number;
  units: number;
  revenueMinor: number;
}

/** Best sellers by paid revenue in the range (store-local days), matching the revenue total, with their views. */
export async function topProducts(trx: Trx, from: string, to: string, timeZone: string, limit = 10): Promise<TopProduct[]> {
  const tz = timeZone;
  const { rows } = await sql<{ product_id: string; title: string; units: number; revenue: string; views: number; added: number }>`
    WITH sales AS (
      SELECT i.product_id, sum(i.quantity)::int AS units, sum(i.total_minor - i.discount_minor)::bigint AS revenue
        FROM app.order_items i JOIN app.orders o ON o.id = i.order_id
       WHERE o.status = 'open' AND o.payment_status <> 'pending' AND i.product_id IS NOT NULL
         AND (o.placed_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
       GROUP BY i.product_id
    ), views AS (
      SELECT product_id, sum(views)::int AS views, sum(added_to_cart)::int AS added
        FROM app.analytics_products_daily WHERE day BETWEEN ${from}::date AND ${to}::date GROUP BY product_id
    )
    SELECT p.id AS product_id, p.title, coalesce(s.units, 0) AS units, coalesce(s.revenue, 0) AS revenue, coalesce(v.views, 0) AS views, coalesce(v.added, 0) AS added
      FROM app.products p
      LEFT JOIN sales s ON s.product_id = p.id
      LEFT JOIN views v ON v.product_id = p.id
     WHERE s.product_id IS NOT NULL OR v.product_id IS NOT NULL
     ORDER BY coalesce(s.revenue, 0) DESC, coalesce(v.views, 0) DESC, p.title
     LIMIT ${limit}`.execute(trx);
  return rows.map((r) => ({ productId: r.product_id, title: r.title, units: r.units, revenueMinor: Number(r.revenue), views: r.views, addedToCart: r.added }));
}

/** Customers who ordered in the range, and how many of them had ordered before or ordered more than once. */
export async function customerMix(trx: Trx, from: string, to: string, timeZone: string): Promise<{ customers: number; returning: number }> {
  const tz = timeZone;
  const { rows } = await sql<{ customers: number; returning: number }>`
    WITH buyers AS (
      SELECT DISTINCT customer_id FROM app.orders
       WHERE status = 'open' AND (placed_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
    )
    SELECT count(*)::int AS customers,
           count(*) FILTER (WHERE (SELECT count(*) FROM app.orders o WHERE o.customer_id = b.customer_id AND o.status = 'open' AND (o.placed_at AT TIME ZONE ${tz})::date <= ${to}::date) > 1)::int AS returning
      FROM buyers b`.execute(trx);
  return rows[0] ?? { customers: 0, returning: 0 };
}

/** Today's date in a time zone, "YYYY-MM-DD". */
export function today(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Stores with visits or order changes since a moment, across stores (worker only). */
export async function activeStores(workerDb: Kysely<Database>, since: Date): Promise<string[]> {
  const { rows } = await sql<{ store_id: string }>`SELECT store_id FROM app.analytics_active_stores(${since})`.execute(workerDb);
  return rows.map((r) => r.store_id);
}

/** Deletes raw events older than the retention period, a batch at a time (worker only). */
export async function purgeOldEvents(workerDb: Kysely<Database>, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000);
  const { rows } = await sql<{ n: number }>`SELECT app.purge_analytics_events(${before}, 20000) AS n`.execute(workerDb);
  return rows[0]?.n ?? 0;
}
