"use client";

import {
  ArrowRightIcon,
  CalendarIcon,
  CartIcon,
  CheckIcon,
  ClockIcon,
  EditIcon,
  EyeIcon,
  InventoryIcon,
  OfferIcon,
  PlusIcon,
  ProductIcon,
  QrIcon,
  RocketIcon,
  RevenueIcon,
  ShareIcon,
  TruckIcon,
  UsersIcon,
  XCircleIcon,
} from "@workeasy/ui/react";
import { useEffect, useState } from "react";
import { change, LineChart } from "../../../components/charts";
import { Thumb } from "../../../components/media";
import { ShareStoreDialog } from "../../../components/share-store";
import type { AnalyticsReport } from "../../../lib/analytics";
import { api, storefrontUrl } from "../../../lib/api";
import { PAYMENT_LABELS, type OrderSummary } from "../../../lib/orders";
import { useStore } from "./store-shell";

interface SalesSummary {
  revenueMinor: number;
  orders: number;
  paidOrders: number;
  bookedMinor: number;
  daily: Array<{ day: string; totalMinor: number }>;
}

interface OrderCounts {
  all: number;
  unpaid: number;
  unfulfilled: number;
  cancelled: number;
  fulfilled: number;
  partial: number;
}

interface LowStockRow {
  variantId: string;
  productId: string;
  productTitle: string;
  imageId: string | null;
  options: string[];
  sku: string | null;
  available: number;
}

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

function greeting(timezone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  } catch {
    // Unknown zone: the browser's clock is close enough for a greeting.
  }
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function money(amountMinor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(0)}`;
  }
}

/** One status per order for the dashboard table, most important first. */
function orderStatus(o: OrderSummary): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (o.status === "cancelled") return { label: "Cancelled", tone: "danger" };
  if (o.fulfillmentStatus === "fulfilled") return { label: "Fulfilled", tone: "success" };
  if (o.fulfillmentStatus === "partially_fulfilled") return { label: "Partly sent", tone: "info" };
  if (o.paymentStatus === "pending") return { label: "Awaiting payment", tone: "warning" };
  return { label: "Processing", tone: "warning" };
}

/** Short payment labels for the table: Online, COD, UPI, Bank. */
function paymentShort(method: OrderSummary["paymentMethod"]): string {
  return method === "card" ? "Online" : method === "cod" ? "COD" : method === "bank" ? "Bank" : PAYMENT_LABELS[method];
}

/**
 * Home: how the store is doing over the chosen period, what needs doing now
 * (orders by state, the launch checklist, low stock) and shortcuts, laid
 * out as in the Commerce designs. Every figure comes from the store's own
 * records; comparisons appear only where the previous period is known.
 */
export default function DashboardPage() {
  const ctx = useStore();
  const [period, setPeriod] = useState<Period>(30);
  const [series, setSeries] = useState<"sales" | "orders">("sales");
  const [report, setReport] = useState<AnalyticsReport | undefined>();
  const [sales, setSales] = useState<SalesSummary | undefined>();
  const [counts, setCounts] = useState<OrderCounts | undefined>();
  const [recent, setRecent] = useState<OrderSummary[] | undefined>();
  const [customers, setCustomers] = useState<number | undefined>();
  const [catalog, setCatalog] = useState<{ products: number; low: number; out: number } | undefined>();
  const [lowStock, setLowStock] = useState<LowStockRow[] | undefined>();
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [zones, setZones] = useState(0);
  const [published, setPublished] = useState(false);
  const [sharing, setSharing] = useState(false);

  const storeId = ctx?.store.id;
  const can = (p: string) => ctx?.can(p) ?? false;
  const canAnalytics = can("analytics.read");
  const canOrders = can("orders.read");
  const canProducts = can("products.read");
  const canStock = can("inventory.read");
  const canCustomers = can("customers.read") || canOrders;
  const canDesign = can("design.manage");

  // Figures for the chosen period.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    if (canAnalytics) {
      api<AnalyticsReport>(`/api/v1/stores/${storeId}/analytics?days=${period}`)
        .then((r) => !cancelled && setReport(r))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [storeId, canAnalytics, period]);

  // Everything that doesn't depend on the period.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const store = `/api/v1/stores/${storeId}`;
    const set = <T,>(p: Promise<T>, apply: (v: T) => void) => p.then((v) => !cancelled && apply(v)).catch(() => undefined);
    if (canOrders) {
      set(api<SalesSummary>(`${store}/sales-summary`), setSales);
      set(api<{ items: OrderSummary[]; counts: OrderCounts }>(`${store}/orders?limit=5`), (r) => {
        setRecent(r.items);
        setCounts(r.counts);
      });
      set(api<{ settings: { upiEnabled: boolean; bankEnabled: boolean; codEnabled: boolean } }>(`${store}/checkout-settings`), (r) =>
        setCheckoutReady(Boolean(r.settings.upiEnabled || r.settings.bankEnabled || r.settings.codEnabled)),
      );
      set(api<{ zones: unknown[] }>(`${store}/shipping/zones`), (r) => setZones(r.zones.length));
    }
    if (canCustomers) set(api<{ total: number }>(`${store}/customers`), (r) => setCustomers(r.total));
    if (canProducts) {
      set(
        Promise.all([
          api<{ counts: { active: number; draft: number } }>(`${store}/products?limit=1`),
          canStock ? api<{ summary: { low: number; out: number } }>(`${store}/inventory?limit=1`) : Promise.resolve(undefined),
        ]),
        ([p, s]) => setCatalog({ products: p.counts.active + p.counts.draft, low: s?.summary.low ?? 0, out: s?.summary.out ?? 0 }),
      );
    }
    if (canStock) set(api<{ items: LowStockRow[] }>(`${store}/inventory?filter=low&limit=3`), (r) => setLowStock(r.items));
    if (canDesign) set(api<{ publishedAt: string | null }>(`${store}/design`), (r) => setPublished(r.publishedAt !== null));
    return () => {
      cancelled = true;
    };
  }, [storeId, canOrders, canCustomers, canProducts, canStock, canDesign]);

  if (!ctx) return null;
  const { store, base } = ctx;
  const shopUrl = storefrontUrl(store.slug);
  const firstName = ctx.userName.split(/\s+/)[0] ?? ctx.userName;
  const fmt = (m: number) => money(m, store.currency, store.defaultLocale);
  const t = report?.totals;
  const prev = report?.previous;

  const delta = (cur: number, before: number) => {
    const c = change(cur, before, period);
    if (!c) return null;
    // "↑ 18% vs the previous 30 days": the arrow and figure in bold, as in the designs.
    const m = /^([↑↓] \d+%) (.*)$/.exec(c.text);
    if (!m) return c.text;
    return (
      <>
        <b data-tone={c.tone === "down" ? "down" : undefined}>{m[1]}</b> {m[2]}
      </>
    );
  };

  const steps = [
    { title: "Store Details", done: store.contactEmail !== null, href: `${base}/settings` },
    { title: "Add First Product", done: (catalog?.products ?? 0) > 0, href: `${base}/products/new` },
    { title: "Payment Method", done: checkoutReady, href: `${base}/settings/checkout` },
    { title: "Delivery / Pickup", done: zones > 0, href: `${base}/shipping` },
    { title: "Preview & Publish", done: published, href: `${base}/design` },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const points = report
    ? report.series.map((d) => ({
        label: new Date(`${d.day}T00:00:00`).toLocaleDateString(store.defaultLocale, { day: "numeric", month: "short" }),
        value: series === "sales" ? d.revenueMinor : d.orders,
      }))
    : (sales?.daily ?? []).map((d) => ({ label: new Date(`${d.day}T00:00:00`).toLocaleDateString(store.defaultLocale, { day: "numeric", month: "short" }), value: d.totalMinor }));

  const snapshot = counts && [
    { label: "Fulfilled", value: counts.fulfilled, color: "var(--we-success)", icon: <CheckIcon size={15} />, href: `${base}/orders` },
    { label: "Partly sent", value: counts.partial, color: "var(--we-info)", icon: <TruckIcon size={15} />, href: `${base}/orders` },
    { label: "To fulfil", value: counts.unfulfilled, color: "var(--we-warning)", icon: <ClockIcon size={15} />, href: `${base}/orders?tab=unfulfilled` },
    { label: "Cancelled", value: counts.cancelled, color: "var(--we-error)", icon: <XCircleIcon size={15} />, href: `${base}/orders?tab=cancelled` },
  ];

  return (
    <div className="c-page" style={{ maxWidth: 1320 }}>
      <div className="c-page-head c-greeting">
        <div>
          <h1>
            {greeting(store.timezone)}, {firstName}! <span aria-hidden="true">👋</span>
          </h1>
          <p className="c-subtitle">Here&apos;s how your store is performing today.</p>
        </div>
        {canAnalytics && (
          <label className="c-input-icon" style={{ minWidth: 190 }}>
            <CalendarIcon size={18} />
            <span className="c-visually-hidden">Period</span>
            <select className="c-select" style={{ paddingLeft: 42, minHeight: 44 }} value={period} onChange={(e) => setPeriod(Number(e.target.value) as Period)}>
              {PERIODS.map((d) => (
                <option key={d} value={d}>
                  Last {d} Days
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <section className="c-kpis" aria-label="Key figures">
        <a className="c-card c-kpi" href={`${base}/orders`}>
          <span className="c-icon-tile" data-tone="green">
            <CartIcon />
          </span>
          <div>
            <span className="c-kpi-label">Total Orders</span>
            <span className="c-kpi-value">{(t?.orders ?? sales?.orders ?? 0).toLocaleString(store.defaultLocale)}</span>
            <span className="c-kpi-foot">{t && prev ? (delta(t.orders, prev.orders) ?? `Last ${period} days`) : "Last 30 days"}</span>
          </div>
        </a>
        <a className="c-card c-kpi" href={canAnalytics ? `${base}/analytics` : `${base}/orders`}>
          <span className="c-icon-tile" data-tone="amber">
            <RevenueIcon />
          </span>
          <div>
            <span className="c-kpi-label">Total Sales</span>
            <span className="c-kpi-value">{fmt(t?.revenueMinor ?? sales?.revenueMinor ?? 0)}</span>
            <span className="c-kpi-foot">{t && prev ? (delta(t.revenueMinor, prev.revenueMinor) ?? "Paid orders") : "Paid orders, last 30 days"}</span>
          </div>
        </a>
        <a className="c-card c-kpi" href={`${base}/orders/customers`}>
          <span className="c-icon-tile" data-tone="blue">
            <UsersIcon />
          </span>
          <div>
            <span className="c-kpi-label">Total Customers</span>
            <span className="c-kpi-value">{(customers ?? 0).toLocaleString(store.defaultLocale)}</span>
            <span className="c-kpi-foot">{report ? `${report.customers.customers.toLocaleString(store.defaultLocale)} bought in ${period} days` : "Everyone who has ordered"}</span>
          </div>
        </a>
        <a className="c-card c-kpi" href={`${base}/products`}>
          <span className="c-icon-tile" data-tone="pink">
            <ProductIcon />
          </span>
          <div>
            <span className="c-kpi-label">Products</span>
            <span className="c-kpi-value">{(catalog?.products ?? 0).toLocaleString(store.defaultLocale)}</span>
            {catalog && catalog.low + catalog.out > 0 ? (
              <span className="c-kpi-alert">Low Stock: {catalog.low + catalog.out}</span>
            ) : (
              <span className="c-kpi-foot">In your catalog</span>
            )}
          </div>
        </a>
      </section>

      <div className="c-dash">
        <section className="c-card" aria-labelledby="sales-h">
          <div className="c-card-head">
            <h2 id="sales-h">Sales Overview</h2>
            {report && (
              <div className="c-segmented" role="group" aria-label="Show">
                <button type="button" aria-pressed={series === "sales"} onClick={() => setSeries("sales")}>
                  Sales
                </button>
                <button type="button" aria-pressed={series === "orders"} onClick={() => setSeries("orders")}>
                  Orders
                </button>
              </div>
            )}
          </div>
          {points.length > 1 && points.some((x) => x.value > 0) ? (
            <LineChart points={points} name={series === "sales" ? "Sales" : "Orders"} format={series === "sales" ? fmt : (v) => v.toLocaleString(store.defaultLocale)} color="var(--we-accent-bright)" height={220} />
          ) : (
            <p className="c-muted" style={{ margin: "40px 0", textAlign: "center" }}>
              Your sales trend appears here after your first orders.
            </p>
          )}
        </section>

        <section className="c-card" aria-labelledby="snap-h">
          <div className="c-card-head">
            <h2 id="snap-h">Orders Snapshot</h2>
            <a className="c-btn c-btn-ghost c-btn-icon c-btn-sm" href={`${base}/orders`} aria-label="All orders">
              <ArrowRightIcon size={18} />
            </a>
          </div>
          {snapshot ? (
            <ul className="c-snapshot">
              {snapshot.map((s) => (
                <li key={s.label}>
                  <a href={s.href}>
                    <span className="c-dot-icon" style={{ background: s.color }} aria-hidden="true">
                      {s.icon}
                    </span>
                    <span>{s.label}</span>
                    <strong>{s.value.toLocaleString(store.defaultLocale)}</strong>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="c-skeleton" style={{ height: 150 }} />
          )}
        </section>

        <section className="c-card c-launch" aria-labelledby="launch-h">
          <div className="c-card-head" style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="c-icon-tile" data-tone="green" style={{ width: 44, height: 44 }}>
                <RocketIcon />
              </span>
              <div>
                <h2 id="launch-h">Launch Checklist</h2>
                <span className="c-muted" style={{ fontSize: "var(--we-font-size-sm)" }}>
                  {done} of {steps.length} Completed
                </span>
              </div>
            </div>
          </div>
          <div className="c-progress" role="progressbar" aria-label="Launch progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <i style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ol className="c-checklist" style={{ marginTop: 10 }}>
            {steps.map((s) => (
              <li key={s.title}>
                <span className="c-check" data-done={s.done ? "true" : undefined}>
                  <CheckIcon size={13} />
                </span>
                <a href={s.href}>{s.title}</a>
                <span className="c-visually-hidden">{s.done ? "done" : "to do"}</span>
                {next === s && (
                  <a className="c-btn c-btn-primary c-btn-sm" href={s.href}>
                    Complete <ArrowRightIcon size={14} />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="c-dash-2">
        <div className="c-dash-col">
          <section className="c-card" aria-labelledby="quick-h">
            <div className="c-card-head">
              <h2 id="quick-h">Quick Actions</h2>
            </div>
            <div className="c-quick">
              {can("products.manage") && (
                <a href={`${base}/products/new`}>
                  <PlusIcon /> Add Product
                </a>
              )}
              {canDesign && (
                <a href={`${base}/design`}>
                  <EditIcon /> Edit Store
                </a>
              )}
              <button type="button" onClick={() => setSharing(true)}>
                <ShareIcon /> Share Store (Link / QR)
              </button>
              {can("offers.manage") && (
                <a href={`${base}/offers`}>
                  <OfferIcon /> Create Offer
                </a>
              )}
              <button type="button" onClick={() => setSharing(true)}>
                <QrIcon /> Download QR Code
              </button>
              <a href={shopUrl} target="_blank" rel="noreferrer">
                <EyeIcon /> View Store
              </a>
            </div>
          </section>

          {canOrders && (
            <section className="c-card c-card-flush" aria-labelledby="recent-h">
              <div className="c-card-head" style={{ padding: "18px 20px 0" }}>
                <h2 id="recent-h">Recent Orders</h2>
                <a href={`${base}/orders`} style={{ fontWeight: 600, textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
                  View All Orders <ArrowRightIcon size={16} />
                </a>
              </div>
              {recent && recent.length > 0 ? (
                <div style={{ overflowX: "auto", padding: "0 8px 8px" }}>
                  <table className="c-table c-table-stack">
                    <thead>
                      <tr>
                        <th scope="col">Order ID</th>
                        <th scope="col">Customer</th>
                        <th scope="col" className="c-num">
                          Amount
                        </th>
                        <th scope="col">Payment</th>
                        <th scope="col">Status</th>
                        <th scope="col">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((o) => {
                        const st = orderStatus(o);
                        return (
                          <tr key={o.id}>
                            <td data-label="Order">
                              <a className="c-cell-title" href={`${base}/orders/${o.id}`}>
                                #{o.number}
                              </a>
                            </td>
                            <td data-label="Customer">
                              <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                                <span className="c-avatar" style={{ width: 30, height: 30, background: "var(--we-tile-blue-soft)", color: "var(--we-tile-blue)" }} aria-hidden="true">
                                  {o.name.slice(0, 1).toUpperCase()}
                                </span>
                                {o.name}
                              </span>
                            </td>
                            <td data-label="Amount" className="c-num">
                              {money(o.totalMinor, o.currency, store.defaultLocale)}
                            </td>
                            <td data-label="Payment">{paymentShort(o.paymentMethod)}</td>
                            <td data-label="Status">
                              <span className="c-badge" data-tone={st.tone === "neutral" ? undefined : st.tone}>
                                {st.label}
                              </span>
                            </td>
                            <td data-label="Date">{new Date(o.placedAt).toLocaleDateString(store.defaultLocale, { day: "numeric", month: "short", year: "numeric" })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="c-muted" style={{ padding: "24px 20px", margin: 0 }}>
                  No orders yet. Share your store link or QR code to get your first one.
                </p>
              )}
            </section>
          )}
        </div>

        {canStock && (
          <section className="c-card" aria-labelledby="low-h">
            <div className="c-card-head">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <InventoryIcon size={22} />
                <h2 id="low-h">Low Stock Products</h2>
              </div>
              <a href={`${base}/inventory`} style={{ fontWeight: 600, textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
                View All <ArrowRightIcon size={16} />
              </a>
            </div>
            {lowStock && lowStock.length > 0 ? (
              <ul className="c-stock-list">
                {lowStock.map((r) => (
                  <li key={r.variantId}>
                    <a href={`${base}/products/${r.productId}`}>
                      <Thumb mediaId={r.imageId} alt="" />
                      <div>
                        <strong className="c-cell-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.productTitle}
                          {r.options.length > 0 ? ` · ${r.options.join(" / ")}` : ""}
                        </strong>
                        <span className="c-cell-sub">{r.sku ? `SKU: ${r.sku}` : "No SKU"}</span>
                      </div>
                      <span className="c-stock-left">{r.available} left</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="c-muted" style={{ margin: 0 }}>
                {lowStock ? "Nothing is running low. Products appear here when stock drops to their alert level." : "Loading…"}
              </p>
            )}
          </section>
        )}
      </div>

      <ShareStoreDialog open={sharing} onClose={() => setSharing(false)} url={shopUrl} storeName={store.name} slug={store.slug} />
    </div>
  );
}
