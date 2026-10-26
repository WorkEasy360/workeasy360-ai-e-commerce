"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { ArrowLeftIcon, EmptyState, Page, PageHeader, SearchIcon, UsersIcon } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  orders: number;
  spentMinor: number;
  lastOrderAt: string | null;
}

interface CustomerPage {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

/** Customers: everyone who has ordered, with their order count and spend, most recent first. */
export default function CustomersPage() {
  const ctx = useStore();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      api<CustomerPage>(`/api/v1/stores/${storeId}/customers?${params.toString()}`)
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
  }, [storeId, q, page]);

  if (!ctx) return null;
  const { base, store } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Page>
      <a className="c-back" href={`${base}/orders`}>
        <ArrowLeftIcon size={14} /> Orders
      </a>
      <PageHeader title="Customers" eyebrow="Sales" subtitle={data ? `${data.total} customer${data.total === 1 ? "" : "s"} who have ordered from ${store.name}.` : "Everyone who has ordered from your store."} />
      {data && data.total === 0 && !q ? (
        <EmptyState icon={<UsersIcon size={26} />} title="No customers yet">
          Shoppers become customers when they place their first order.
        </EmptyState>
      ) : (
        <>
          <div className="c-toolbar">
            <div className="c-search">
              <SearchIcon size={16} />
              <input
                className="c-input"
                type="search"
                placeholder="Search name, email or phone"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                aria-label="Search customers"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="c-error">
              {error}
            </p>
          )}
          <div className="c-table-wrap">
            <table className="c-table c-table-stack">
              <caption className="c-visually-hidden">Customers</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="c-num">
                    Orders
                  </th>
                  <th scope="col" className="c-num">
                    Spent
                  </th>
                  <th scope="col">Last order</th>
                </tr>
              </thead>
              <tbody>
                {data === undefined ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="c-skeleton" role="status" aria-label="Loading customers" />
                    </td>
                  </tr>
                ) : data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                      No customers match.
                    </td>
                  </tr>
                ) : (
                  data.items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Customer">
                        <a className="c-cell-title" href={`${base}/orders/customers/${c.id}`}>
                          {c.name}
                        </a>
                        <span className="c-cell-sub">{c.email}</span>
                      </td>
                      <td data-label="Phone">{c.phone ?? "—"}</td>
                      <td data-label="Orders" className="c-num">
                        {c.orders}
                      </td>
                      <td data-label="Spent" className="c-num">
                        {formatMoney(c.spentMinor, store.currency, locale)}
                      </td>
                      <td data-label="Last order">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="c-pager" style={{ gap: 8, alignItems: "center" }}>
              <button type="button" className="c-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="c-muted">
                Page {page} of {pages}
              </span>
              <button type="button" className="c-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
