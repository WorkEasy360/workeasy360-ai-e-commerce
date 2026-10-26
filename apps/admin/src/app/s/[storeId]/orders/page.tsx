"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { Badge, EmptyState, OrderIcon, Page, PageHeader, SearchIcon } from "@workeasy/ui/react";
import { api, errorMessage, storefrontUrl } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import { orderBadges, PAYMENT_LABELS, type OrderSummary } from "../../../../lib/orders";
import { useStore } from "../store-shell";

type Tab = "all" | "unpaid" | "unfulfilled" | "cancelled";
interface OrderPage {
  items: OrderSummary[];
  counts: Record<Tab, number>;
  nextCursor?: string;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Payment pending" },
  { key: "unfulfilled", label: "To fulfil" },
  { key: "cancelled", label: "Cancelled" },
];

/** Orders: every order from the storefront, by tab, newest first. */
export default function OrdersPage() {
  const ctx = useStore();
  const mod = moduleByKey("orders");
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<OrderPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  const url = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ tab, limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      return `/api/v1/stores/${storeId}/orders?${params.toString()}`;
    },
    [storeId, tab, q],
  );

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<OrderPage>(url())
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeId, url]);

  if (!ctx) return null;
  const { base, store } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;

  async function loadMore() {
    if (!data?.nextCursor) return;
    try {
      const page = await api<OrderPage>(url(data.nextCursor));
      setData({ ...page, items: [...data.items, ...page.items] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const related = (
    <>
      <a className="c-btn" href={`${base}/orders/customers`}>
        Customers
      </a>
      <a className="c-btn" href={`${base}/orders/bookings`}>
        Bookings
      </a>
      <a className="c-btn" href={`${base}/orders/abandoned`}>
        Abandoned checkouts
      </a>
    </>
  );

  if (data && data.counts.all === 0 && !q) {
    return (
      <Page>
        <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
        <EmptyState
          icon={<OrderIcon size={26} />}
          title="No orders yet"
          actions={
            <a className="c-btn c-btn-primary" href={storefrontUrl(store.slug)} target="_blank" rel="noreferrer">
              Visit your store
            </a>
          }
        >
          Orders placed on your storefront appear here, whether shoppers pay online, by UPI, bank transfer, cash on delivery or order on WhatsApp.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} actions={related} />
      <nav className="c-tabs" aria-label="Order status">
        {TABS.map((t) => (
          <a
            key={t.key}
            href="#"
            aria-current={tab === t.key ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setTab(t.key);
            }}
          >
            {t.label}
            {data && <span className="c-muted"> {data.counts[t.key]}</span>}
          </a>
        ))}
      </nav>
      <div className="c-toolbar">
        <div className="c-search">
          <SearchIcon size={16} />
          <input className="c-input" type="search" placeholder="Search order number, name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        </div>
      </div>
      {error && (
        <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      <div className="c-table-wrap">
        <table className="c-table c-table-stack">
          <caption className="c-visually-hidden">Orders</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Date</th>
              <th scope="col">Customer</th>
              <th scope="col">Payment</th>
              <th scope="col">Status</th>
              <th scope="col" className="c-num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data === undefined ? (
              <tr>
                <td colSpan={6}>
                  <div className="c-skeleton" role="status" aria-label="Loading orders" />
                </td>
              </tr>
            ) : data.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                  No orders here.
                </td>
              </tr>
            ) : (
              data.items.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order">
                    <a className="c-cell-title" href={`${base}/orders/${o.id}`}>
                      #{o.number}
                    </a>
                    <span className="c-cell-sub">
                      {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td data-label="Date">{new Date(o.placedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td data-label="Customer">
                    <span className="c-cell-title">{o.name}</span>
                    <span className="c-cell-sub">{o.email}</span>
                  </td>
                  <td data-label="Payment">{PAYMENT_LABELS[o.paymentMethod]}</td>
                  <td data-label="Status">
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      {orderBadges(o).map((b) => (
                        <Badge key={b.label} tone={b.tone}>
                          {b.label}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td data-label="Total" className="c-num">
                    {formatMoney(o.totalMinor, o.currency, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data?.nextCursor && (
        <div className="c-pager">
          <button type="button" className="c-btn" onClick={() => void loadMore()}>
            Show more
          </button>
        </div>
      )}
    </Page>
  );
}
