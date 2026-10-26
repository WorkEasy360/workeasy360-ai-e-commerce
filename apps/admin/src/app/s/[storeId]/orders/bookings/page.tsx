"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon, Badge, CalendarIcon, EmptyState, Page, PageHeader, PhoneIcon } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Booking {
  orderId: string;
  orderNumber: number;
  customer: string;
  email: string;
  phone: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  at: string;
  paymentStatus: string;
}

/** Upcoming bookings for services, by day, in the store's time zone. */
export default function BookingsPage() {
  const ctx = useStore();
  const [items, setItems] = useState<Booking[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<{ items: Booking[] }>(`/api/v1/stores/${storeId}/bookings?days=60`)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  if (!ctx) return null;
  const { base, store } = ctx;
  const timeZone = store.timezone;
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone });
  const days = new Map<string, Booking[]>();
  for (const b of items ?? []) days.set(dayKey(b.at), [...(days.get(dayKey(b.at)) ?? []), b]);

  return (
    <Page>
      <a className="c-back" href={`${base}/orders`}>
        <ArrowLeftIcon size={14} /> Orders
      </a>
      <PageHeader title="Bookings" eyebrow="Sales" subtitle={`The next 60 days of booked services, in ${timeZone} time. Cancelled orders free their slot.`} />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {items === undefined ? (
        <div className="c-skeleton" role="status" aria-label="Loading bookings" style={{ height: 120 }} />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarIcon size={26} />} title="No upcoming bookings">
          When shoppers book a service, each booking shows here by day, with the customer&apos;s details.
        </EmptyState>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <section key={day} className="c-section" aria-labelledby={`d-${day}`}>
            <div className="c-section-head">
              <h2 id={`d-${day}`}>{new Date(list[0]!.at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone })}</h2>
              <span className="c-muted">
                {list.length} booking{list.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="c-table-wrap">
              <table className="c-table c-table-stack">
                <caption className="c-visually-hidden">Bookings on {day}</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Service</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const digits = b.phone?.replace(/\D/g, "") ?? "";
                    return (
                      <tr key={`${b.orderId}-${b.at}-${b.title}`}>
                        <td data-label="Time">
                          <strong>{new Date(b.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone })}</strong>
                        </td>
                        <td data-label="Service">
                          <span className="c-cell-title">{b.title}</span>
                          <span className="c-cell-sub">{[b.variantTitle, b.quantity > 1 ? `${b.quantity} places` : null].filter(Boolean).join(" · ")}</span>
                        </td>
                        <td data-label="Customer">
                          <span className="c-cell-title">{b.customer}</span>
                          <span className="c-cell-sub">
                            {b.email}
                            {digits.length >= 8 && (
                              <>
                                {" · "}
                                <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
                                  <PhoneIcon size={12} /> WhatsApp
                                </a>
                              </>
                            )}
                          </span>
                        </td>
                        <td data-label="Order">
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <a className="c-cell-title" href={`${base}/orders/${b.orderId}`}>
                              #{b.orderNumber}
                            </a>
                            <Badge tone={b.paymentStatus === "pending" ? "warning" : "success"}>{b.paymentStatus === "pending" ? "Payment pending" : "Paid"}</Badge>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </Page>
  );
}
