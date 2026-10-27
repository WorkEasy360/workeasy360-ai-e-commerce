"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { ArrowLeftIcon, CartIcon, EmptyState, Page, PageHeader, PhoneIcon } from "@workeasy/ui/react";
import { api, errorMessage, storefrontUrl } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Abandoned {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  items: Array<{ title?: string; variantTitle?: string | null; quantity?: number }>;
  subtotalMinor: number;
  currency: string;
  updatedAt: string;
}

/**
 * Abandoned checkouts: shoppers who reached checkout, gave their email and
 * left without ordering in the last while. A friendly nudge often wins them back.
 */
export default function AbandonedPage() {
  const ctx = useStore();
  const [items, setItems] = useState<Abandoned[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<{ items: Abandoned[] }>(`/api/v1/stores/${storeId}/checkouts/abandoned`)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  if (!ctx) return null;
  const { base, store } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const shopUrl = `${storefrontUrl(store.slug)}/cart`;
  const nudge = (a: Abandoned) => `Hi${a.name ? ` ${a.name.split(" ")[0]}` : ""}! You left ${a.items.map((i) => i.title).filter(Boolean).join(", ")} in your cart at ${store.name}. It's still waiting for you: ${shopUrl}`;

  return (
    <Page>
      <a className="c-back" href={`${base}/orders`}>
        <ArrowLeftIcon size={14} /> Orders
      </a>
      <PageHeader title="Abandoned checkouts" eyebrow="Sales" subtitle="Shoppers who started checking out and left without ordering, after an hour." />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {items && items.length === 0 ? (
        <EmptyState icon={<CartIcon size={26} />} title="No abandoned checkouts">
          When a shopper enters their email at checkout and doesn&apos;t finish within an hour, they show up here so you can follow up.
        </EmptyState>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table c-table-stack">
            <caption className="c-visually-hidden">Abandoned checkouts</caption>
            <thead>
              <tr>
                <th scope="col">Shopper</th>
                <th scope="col">Cart</th>
                <th scope="col">Left</th>
                <th scope="col" className="c-num">
                  Value
                </th>
                <th scope="col">
                  <span className="c-visually-hidden">Follow up</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items === undefined ? (
                <tr>
                  <td colSpan={5}>
                    <div className="c-skeleton" role="status" aria-label="Loading checkouts" />
                  </td>
                </tr>
              ) : (
                items.map((a) => {
                  const digits = a.phone?.replace(/\D/g, "") ?? "";
                  return (
                    <tr key={a.id}>
                      <td data-label="Shopper">
                        <span className="c-cell-title">{a.name ?? a.email}</span>
                        <span className="c-cell-sub">{a.name ? a.email : a.phone}</span>
                      </td>
                      <td data-label="Cart">{a.items.map((i) => `${i.quantity ?? 1} × ${i.title ?? "item"}${i.variantTitle ? ` (${i.variantTitle})` : ""}`).join(", ")}</td>
                      <td data-label="Left">{new Date(a.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td data-label="Value" className="c-num">
                        {formatMoney(a.subtotalMinor, a.currency, locale)}
                      </td>
                      <td data-label="Follow up">
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <a className="c-btn c-btn-sm" href={`mailto:${a.email}?subject=${encodeURIComponent(`Your cart at ${store.name}`)}&body=${encodeURIComponent(nudge(a))}`}>
                            Email
                          </a>
                          {digits.length >= 8 && (
                            <a className="c-btn c-btn-sm" href={`https://wa.me/${digits}?text=${encodeURIComponent(nudge(a))}`} target="_blank" rel="noreferrer">
                              <PhoneIcon size={13} /> WhatsApp
                            </a>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
