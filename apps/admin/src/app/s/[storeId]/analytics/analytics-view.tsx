"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { AnalyticsIcon, Card, ConversionIcon, DownloadIcon, EmptyState, OrderIcon, Page, PageHeader, RevenueIcon, StatCard, UsersIcon } from "@workeasy/ui/react";
import { BarList, change, Funnel, LineChart } from "../../../../components/charts";
import { api, errorMessage, storefrontUrl } from "../../../../lib/api";
import type { AnalyticsReport } from "../../../../lib/analytics";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

const RANGES = [7, 30, 90] as const;

/** Analytics: sales and visitors over a range, the funnel, where visitors come from and what sells. */
export function AnalyticsView() {
  const ctx = useStore();
  const mod = moduleByKey("analytics");
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [report, setReport] = useState<AnalyticsReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    api<AnalyticsReport>(`/api/v1/stores/${storeId}/analytics?days=${days}`)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, days]);

  if (!ctx) return null;
  const { store, base } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number) => formatMoney(m, store.currency, locale, { compact: true });
  const r = report;
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
  const delta = (cur: number, prev: number) => {
    const c = change(cur, prev, days);
    return c ? (
      <span className="c-delta" data-tone={c.tone}>
        {c.text}
      </span>
    ) : (
      `Last ${days} days`
    );
  };

  const range = (
    <div className="c-range" role="group" aria-label="Date range">
      {RANGES.map((d) => (
        <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
          {d} days
        </button>
      ))}
    </div>
  );

  return (
    <Page>
      <PageHeader
        title={mod.label}
        eyebrow={mod.group}
        subtitle={r ? `${day(r.from)} – ${day(r.to)}, in ${r.timeZone} time. Orders and revenue are exact; visits count browsers, not people.` : mod.summary}
        actions={
          <>
            {range}
            <a className="c-btn" href={`/api/v1/stores/${store.id}/analytics.csv?days=${days}`} download>
              <DownloadIcon size={16} /> Export CSV
            </a>
          </>
        }
      />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {!r ? (
        <div className="c-skeleton" role="status" aria-label="Loading analytics" style={{ height: 240 }} />
      ) : r.totals.visitors === 0 && r.totals.orders === 0 ? (
        <EmptyState
          icon={<AnalyticsIcon size={26} />}
          title="No visits yet"
          actions={
            <a className="c-btn c-btn-primary" href={storefrontUrl(store.slug)} target="_blank" rel="noreferrer">
              Visit your store
            </a>
          }
        >
          Visits, traffic sources and sales appear here as shoppers find your store. Share your store link on WhatsApp and Instagram to get started.
        </EmptyState>
      ) : (
        <>
          <div className="c-stats" style={{ marginBottom: 20 }}>
            <StatCard label="Revenue" icon={<RevenueIcon size={16} />} value={money(r.totals.revenueMinor)} foot={delta(r.totals.revenueMinor, r.previous.revenueMinor)} />
            <StatCard label="Orders" icon={<OrderIcon size={16} />} value={r.totals.orders.toLocaleString()} foot={delta(r.totals.orders, r.previous.orders)} />
            <StatCard label="Visitors" icon={<UsersIcon size={16} />} value={r.totals.visitors.toLocaleString()} foot={delta(r.totals.visitors, r.previous.visitors)} />
            <StatCard
              label="Conversion rate"
              icon={<ConversionIcon size={16} />}
              value={pct(r.totals.conversionRate)}
              foot={r.totals.orders > 0 ? `Average order ${money(r.totals.averageOrderMinor)}` : "Orders per visitor"}
            />
          </div>

          <div className="c-grid-2 c-grid-even">
            <Card title="Revenue">
              <LineChart name="Revenue" points={r.series.map((d) => ({ label: day(d.day), value: d.revenueMinor }))} format={money} />
            </Card>
            <Card title="Visitors">
              <LineChart name="Visitors" color="var(--we-chart-2)" points={r.series.map((d) => ({ label: day(d.day), value: d.visitors }))} format={(v) => Math.round(v).toLocaleString()} />
            </Card>
          </div>

          <div className="c-grid-2 c-grid-even c-section">
            <Card title="From visit to order">
              <Funnel
                steps={[
                  { label: "Visited the store", value: r.funnel.visitors },
                  { label: "Viewed a product", value: r.funnel.viewedProduct },
                  { label: "Added to cart", value: r.funnel.addedToCart },
                  { label: "Reached checkout", value: r.funnel.reachedCheckout },
                  { label: "Placed an order", value: r.funnel.orders },
                ]}
              />
              <p className="c-hint" style={{ marginBottom: 0 }}>
                Visitors and steps count browser sessions; orders come from your orders.
              </p>
            </Card>
            <Card title="Where visitors come from">
              <BarList
                rows={r.sources.slice(0, 8).map((s) => ({ key: s.source, label: s.source === "direct" ? "Direct or unknown" : s.source, value: s.visitors }))}
                format={(v) => v.toLocaleString()}
                empty="No visits in this period."
              />
              <p className="c-hint" style={{ marginBottom: 0 }}>
                Add <code>?utm_source=instagram</code> to links you share to name the source exactly.
                {r.totals.mobileShare !== null ? ` ${pct(r.totals.mobileShare)} of visitors were on a phone.` : ""}
              </p>
            </Card>
          </div>

          <div className="c-grid-2 c-grid-even c-section">
            <Card title="Top products">
              <BarList
                rows={r.topProducts.map((p) => ({
                  key: p.productId,
                  label: <a href={`${base}/products/${p.productId}`}>{p.title}</a>,
                  value: p.revenueMinor,
                  detail: `${p.units} sold · ${p.views.toLocaleString()} views${p.views > 0 && p.units > 0 ? ` · ${Math.round((p.units / p.views) * 100)}% bought after viewing` : ""}`,
                }))}
                format={money}
                color="var(--we-chart-1)"
                empty="No product sales or views in this period."
              />
            </Card>
            <Card title="Customers">
              <div className="c-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <span className="c-stat-label">Bought in this period</span>
                  <span className="c-stat-value">{r.customers.customers.toLocaleString()}</span>
                </div>
                <div>
                  <span className="c-stat-label">Repeat buyers</span>
                  <span className="c-stat-value">{r.customers.customers ? pct(r.customers.returning / r.customers.customers) : "—"}</span>
                </div>
              </div>
              <p className="c-hint" style={{ marginBottom: 0 }}>
                Repeat buyers had placed an order before, or placed more than one. <a href={`${base}/orders/customers`}>See customers</a>
              </p>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
