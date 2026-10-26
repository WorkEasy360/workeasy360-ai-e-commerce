"use client";

import {
  Badge,
  Card,
  ChatIcon,
  CheckIcon,
  ConversionIcon,
  PlusIcon,
  GlobeIcon,
  OrderIcon,
  Page,
  PageHeader,
  PaymentIcon,
  RevenueIcon,
  SparkleIcon,
  StatCard,
  CartIcon,
  ReviewIcon,
} from "@workeasy/ui/react";
import { useEffect, useState } from "react";
import { BarList, change } from "../../../components/charts";
import type { AnalyticsReport } from "../../../lib/analytics";
import { api, storefrontUrl } from "../../../lib/api";
import { useStore } from "./store-shell";

interface SalesSummary {
  revenueMinor: number;
  orders: number;
  paidOrders: number;
  bookedMinor: number;
  daily: Array<{ day: string; totalMinor: number }>;
  recent: Array<{ id: string; number: number; name: string; status: string; paymentStatus: string; totalMinor: number; currency: string }>;
}

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

interface Step {
  title: string;
  detail: string;
  done: boolean;
  href?: string;
  action: string;
}

/**
 * The dashboard: today's numbers, the setup checklist that walks a new
 * merchant to their first sale, and shortcuts. Figures read zero until
 * orders exist (Orders and Analytics modules).
 */
export default function DashboardPage() {
  const ctx = useStore();
  const [catalog, setCatalog] = useState<{ products: number; low: number; out: number } | undefined>();
  const [sales, setSales] = useState<SalesSummary | undefined>();
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [report, setReport] = useState<AnalyticsReport | undefined>();
  const [pendingReviews, setPendingReviews] = useState(0);
  const [zones, setZones] = useState(0);
  const canAnalytics = ctx?.can("analytics.read") ?? false;
  const canReviews = ctx?.can("reviews.manage") ?? false;
  const canReadOrders = ctx?.can("orders.read") ?? false;
  const storeId = ctx?.store.id;
  const canReadProducts = ctx?.can("products.read") ?? false;
  const canReadStock = ctx?.can("inventory.read") ?? false;

  useEffect(() => {
    if (!storeId || !canReadProducts) return;
    let cancelled = false;
    Promise.all([
      api<{ counts: { active: number; draft: number } }>(`/api/v1/stores/${storeId}/products?limit=1`),
      canReadStock ? api<{ summary: { low: number; out: number } }>(`/api/v1/stores/${storeId}/inventory?limit=1`) : Promise.resolve(undefined),
    ])
      .then(([products, stock]) => {
        if (!cancelled) setCatalog({ products: products.counts.active + products.counts.draft, low: stock?.summary.low ?? 0, out: stock?.summary.out ?? 0 });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeId, canReadProducts, canReadStock]);

  useEffect(() => {
    if (!storeId || !canReadOrders) return;
    let cancelled = false;
    Promise.all([
      api<SalesSummary>(`/api/v1/stores/${storeId}/sales-summary`),
      api<{ settings: { whatsappNumber: string | null; telegramUsername: string | null; upiEnabled: boolean; bankEnabled: boolean; codEnabled: boolean } }>(`/api/v1/stores/${storeId}/checkout-settings`),
    ])
      .then(([summary, checkout]) => {
        if (cancelled) return;
        setSales(summary);
        const c = checkout.settings;
        setCheckoutReady(Boolean(c.whatsappNumber || c.telegramUsername || c.upiEnabled || c.bankEnabled || c.codEnabled));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeId, canReadOrders]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    if (canAnalytics) {
      api<AnalyticsReport>(`/api/v1/stores/${storeId}/analytics?days=30`)
        .then((r) => {
          if (!cancelled) setReport(r);
        })
        .catch(() => undefined);
    }
    if (canReviews) {
      api<{ counts: { pending: number } }>(`/api/v1/stores/${storeId}/reviews?status=pending`)
        .then((r) => {
          if (!cancelled) setPendingReviews(r.counts.pending);
        })
        .catch(() => undefined);
    }
    if (canReadOrders) {
      api<{ zones: unknown[] }>(`/api/v1/stores/${storeId}/shipping/zones`)
        .then((r) => {
          if (!cancelled) setZones(r.zones.length);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [storeId, canAnalytics, canReviews, canReadOrders]);

  if (!ctx) return null;
  const { store, base, can } = ctx;
  const shopUrl = storefrontUrl(store.slug);
  const firstName = ctx.userName.split(/\s+/)[0] ?? ctx.userName;

  const steps: Step[] = [
    { title: "Create your store", detail: `Your shop lives at /s/${store.slug}.`, done: true, action: "Done" },
    {
      title: "Add store details",
      detail: "A contact email shoppers can reach you at.",
      done: store.contactEmail !== null,
      ...(can("settings.manage") ? { href: `${base}/settings` } : {}),
      action: "Add details",
    },
    {
      title: "Add your first product",
      detail: catalog && catalog.products > 0 ? `${catalog.products} product${catalog.products === 1 ? "" : "s"} in your catalog.` : "Physical, digital or a bookable service.",
      done: (catalog?.products ?? 0) > 0,
      href: `${base}/products/new`,
      action: "Add product",
    },
    {
      title: "Choose how you get paid",
      detail: "Cards and UPI online, WhatsApp orders, bank transfer or cash on delivery.",
      done: checkoutReady,
      ...(can("settings.manage") ? { href: `${base}/settings/checkout` } : {}),
      action: "Set up",
    },
    {
      title: "Set delivery options",
      detail: zones > 0 ? `${zones} shipping zone${zones === 1 ? "" : "s"} set up.` : "Shipping zones, rates and local pickup.",
      done: zones > 0,
      href: `${base}/shipping`,
      action: "Set up",
    },
    { title: "Make it yours", detail: "Colours, logo and homepage sections.", done: false, href: `${base}/design`, action: "Customize" },
  ];
  const done = steps.filter((s) => s.done).length;
  const trend = report ? report.series.map((d) => d.revenueMinor) : (sales?.daily ?? []).map((d) => d.totalMinor);
  const t = report?.totals;
  const p = report?.previous;
  const delta = (cur: number, prev: number, fallback: string) => {
    const c = change(cur, prev, 30);
    return c ? (
      <span className="c-delta" data-tone={c.tone}>
        {c.text}
      </span>
    ) : (
      fallback
    );
  };

  return (
    <Page>
      <PageHeader
        title={`${greeting(store.timezone)}, ${firstName}`}
        subtitle={`Here's what's happening at ${store.name}.`}
        actions={
          can("products.manage") && (
            <a className="c-btn c-btn-primary" href={`${base}/products/new`}>
              <PlusIcon size={16} /> Add product
            </a>
          )
        }
      />

      <section className="c-hero" aria-labelledby="hero-title">
        <Badge tone="brand">Store {store.status === "active" ? "online" : "suspended"}</Badge>
        <h2 id="hero-title" style={{ marginTop: 12 }}>
          {(catalog?.products ?? 0) > 0 ? `${store.name} is open for business` : `${store.name} is ready for its first products`}
        </h2>
        <p>
          Share{" "}
          <a href={shopUrl} target="_blank" rel="noreferrer">
            {shopUrl.replace(/^https?:\/\//, "")}
          </a>{" "}
          in your bio, on WhatsApp or anywhere your customers are.{" "}
          {(sales?.orders ?? 0) > 0 ? "New orders show up under Orders and in your inbox." : "Finish the checklist below to take your first order."}
        </p>
      </section>

      <div className="c-section c-stats" aria-label="Last 30 days">
        <StatCard
          label="Revenue"
          icon={<RevenueIcon size={16} />}
          value={money(t?.revenueMinor ?? sales?.revenueMinor ?? 0, store.currency, store.defaultLocale)}
          foot={t && p ? delta(t.revenueMinor, p.revenueMinor, "Paid orders, last 30 days") : "Paid orders, last 30 days"}
          {...(trend.length > 1 ? { trend } : {})}
        />
        <StatCard
          label="Orders"
          icon={<OrderIcon size={16} />}
          value={String(t?.orders ?? sales?.orders ?? 0)}
          foot={sales && sales.orders > sales.paidOrders ? `${sales.orders - sales.paidOrders} awaiting payment` : t && p ? delta(t.orders, p.orders, "Last 30 days") : "Last 30 days"}
        />
        <StatCard
          label="Average order value"
          icon={<CartIcon size={16} />}
          value={t && t.orders > 0 ? money(t.averageOrderMinor, store.currency, store.defaultLocale) : sales && sales.orders > 0 ? money(Math.round(sales.bookedMinor / sales.orders), store.currency, store.defaultLocale) : "—"}
          foot={(t?.orders ?? sales?.orders ?? 0) > 0 ? "Last 30 days" : "Appears after your first order"}
        />
        <StatCard
          label="Conversion rate"
          icon={<ConversionIcon size={16} />}
          value={t?.conversionRate != null ? `${(t.conversionRate * 100).toFixed(t.conversionRate < 0.1 ? 1 : 0)}%` : "—"}
          foot={t && t.visitors > 0 ? `${t.visitors.toLocaleString()} visitors, last 30 days` : "Visits that become orders"}
        />
      </div>

      {pendingReviews > 0 && (
        <div className="c-section c-card" role="status" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="c-icon-tile">
            <ReviewIcon />
          </span>
          <strong>
            {pendingReviews} new review{pendingReviews === 1 ? "" : "s"} to read
          </strong>
          <span className="c-muted">Publish the good ones; reply to the rest.</span>
          <a className="c-btn c-btn-sm" style={{ marginLeft: "auto" }} href={`${base}/reviews`}>
            Review now
          </a>
        </div>
      )}

      {catalog && (catalog.low > 0 || catalog.out > 0) && (
        <div className="c-section c-card" role="status" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong>Stock needs attention:</strong>
          <span className="c-muted">
            {catalog.out > 0 ? `${catalog.out} variant${catalog.out === 1 ? " is" : "s are"} out of stock` : ""}
            {catalog.out > 0 && catalog.low > 0 ? " and " : ""}
            {catalog.low > 0 ? `${catalog.low} running low` : ""}.
          </span>
          <a className="c-btn c-btn-sm" style={{ marginLeft: "auto" }} href={`${base}/inventory`}>
            Review inventory
          </a>
        </div>
      )}

      <div className="c-section c-grid-2">
        <Card
          title="Set up your store"
          actions={
            <span className="c-muted" style={{ fontSize: 13.5 }}>
              {done} of {steps.length} done
            </span>
          }
        >
          <div className="c-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <i style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ol className="c-checklist" style={{ marginTop: 8 }}>
            {steps.map((step) => (
              <li key={step.title}>
                <span className="c-check" data-done={step.done ? "true" : undefined}>
                  <CheckIcon size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </div>
                {!step.done && step.href && (
                  <a className="c-btn c-btn-sm" href={step.href}>
                    {step.action}
                  </a>
                )}
                {step.done && <span className="c-visually-hidden">Done</span>}
              </li>
            ))}
          </ol>
        </Card>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {report && report.topProducts.some((x) => x.revenueMinor > 0) && (
            <Card
              title="Top products, last 30 days"
              actions={
                <a className="c-btn c-btn-sm" href={`${base}/analytics`}>
                  Analytics
                </a>
              }
            >
              <BarList
                rows={report.topProducts
                  .filter((x) => x.revenueMinor > 0)
                  .slice(0, 5)
                  .map((x) => ({ key: x.productId, label: x.title, value: x.revenueMinor, detail: `${x.units} sold` }))}
                format={(v) => money(v, store.currency, store.defaultLocale)}
                empty=""
              />
            </Card>
          )}
          {sales && sales.recent.length > 0 && (
            <Card
              title="Recent orders"
              actions={
                <a className="c-btn c-btn-sm" href={`${base}/orders`}>
                  View all
                </a>
              }
            >
              <ul className="c-checklist">
                {sales.recent.map((o) => (
                  <li key={o.id}>
                    <div style={{ minWidth: 0 }}>
                      <a className="c-cell-title" href={`${base}/orders/${o.id}`}>
                        #{o.number} · {o.name}
                      </a>
                      <span>{o.status === "cancelled" ? "Cancelled" : o.paymentStatus === "paid" ? "Paid" : "Payment pending"}</span>
                    </div>
                    <strong style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{money(o.totalMinor, o.currency, store.defaultLocale)}</strong>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Ways shoppers can pay">
            <ul className="c-checklist">
              <li>
                <span className="c-icon-tile">
                  <PaymentIcon />
                </span>
                <div>
                  <strong>Cards, UPI and netbanking online</strong>
                  <span>Connect your own Razorpay or Stripe account in Payments &amp; Finances.</span>
                </div>
              </li>
              <li>
                <span className="c-icon-tile">
                  <ChatIcon />
                </span>
                <div>
                  <strong>Order on WhatsApp</strong>
                  <span>The cart arrives as a ready-made message.</span>
                </div>
              </li>
              <li>
                <span className="c-icon-tile">
                  <GlobeIcon />
                </span>
                <div>
                  <strong>UPI ID, bank transfer and cash on delivery</strong>
                  <span>With your own payment instructions.</span>
                </div>
              </li>
            </ul>
          </Card>
          {can("ai.use") && (
            <Card>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="c-icon-tile">
                  <SparkleIcon />
                </span>
                <div>
                  <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>AI Studio</h2>
                  <p className="c-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
                    Describe your shop in a sentence and get product descriptions, SEO and collections drafted for you.
                  </p>
                  <a className="c-btn c-btn-brand c-btn-sm" href={`${base}/ai`}>
                    Open AI Studio
                  </a>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
