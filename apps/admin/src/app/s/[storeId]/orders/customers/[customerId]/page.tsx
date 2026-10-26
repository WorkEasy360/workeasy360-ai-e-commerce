"use client";

import { use, useEffect, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { ArrowLeftIcon, Badge, Card, Page, PageHeader, PhoneIcon, StatCard } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../../../lib/api";
import { orderBadges, type OrderSummary } from "../../../../../../lib/orders";
import { useStore } from "../../../store-shell";

interface CustomerDetail {
  customer: { id: string; name: string; email: string; phone: string | null; orders: number; spentMinor: number; lastOrderAt: string | null; createdAt: string };
  orders: OrderSummary[];
}

/** One customer: contact details, what they've spent, and their orders. */
export default function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = use(params);
  const ctx = useStore();
  const [data, setData] = useState<CustomerDetail | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<CustomerDetail>(`/api/v1/stores/${storeId}/customers/${customerId}`)
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, customerId]);

  if (!ctx) return null;
  const { base, store } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number) => formatMoney(m, store.currency, locale);
  const back = (
    <a className="c-back" href={`${base}/orders/customers`}>
      <ArrowLeftIcon size={14} /> Customers
    </a>
  );
  if (!data) {
    return (
      <Page>
        {back}
        {error ? (
          <p role="alert" className="c-error">
            {error}
          </p>
        ) : (
          <div className="c-skeleton" role="status" aria-label="Loading customer" style={{ width: 240, height: 26 }} />
        )}
      </Page>
    );
  }
  const { customer: c, orders } = data;
  const digits = c.phone?.replace(/\D/g, "") ?? "";

  return (
    <Page>
      {back}
      <PageHeader
        title={c.name}
        eyebrow="Customer"
        subtitle={`Customer since ${new Date(c.createdAt).toLocaleDateString(undefined, { dateStyle: "long" })}`}
        actions={
          <>
            <a className="c-btn" href={`mailto:${c.email}`}>
              Email
            </a>
            {digits.length >= 8 && (
              <a className="c-btn" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
                <PhoneIcon size={14} /> WhatsApp
              </a>
            )}
          </>
        }
      />
      <div className="c-stats" style={{ marginBottom: 20 }}>
        <StatCard label="Orders" value={c.orders} />
        <StatCard label="Total spent" value={money(c.spentMinor)} />
        <StatCard label="Average order" value={c.orders > 0 ? money(Math.round(c.spentMinor / c.orders)) : "—"} />
      </div>
      <div className="c-detail">
        <div className="c-detail-main">
          <Card title="Orders" flush>
            <div className="c-table-wrap">
              <table className="c-table c-table-stack">
                <caption className="c-visually-hidden">Orders by {c.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="c-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td data-label="Order">
                        <a className="c-cell-title" href={`${base}/orders/${o.id}`}>
                          #{o.number}
                        </a>
                      </td>
                      <td data-label="Date">{new Date(o.placedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="c-detail-side">
          <Card title="Contact">
            <dl className="c-kv">
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${c.email}`}>{c.email}</a>
              </dd>
              <dt>Phone</dt>
              <dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
