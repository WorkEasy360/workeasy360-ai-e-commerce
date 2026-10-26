"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPriceRange } from "@workeasy/commerce";
import { Badge, DownloadIcon, EmptyState, Page, PageHeader, PlusIcon, ProductIcon, SearchIcon, UploadIcon } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../lib/api";
import { PRODUCT_TYPE_LABELS, STATUS_LABELS, STATUS_TONES, type ProductList, type ProductStatus, type ProductSummary, type ProductType } from "../../../../lib/catalog";
import { moduleByKey } from "../../../../lib/modules";
import { Thumb } from "../../../../components/media";
import { useStore } from "../store-shell";
import { ImportDialog } from "./import-dialog";

type Tab = "all" | ProductStatus;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
];

function stockText(p: ProductSummary): { text: string; tone?: "danger" | "warning" } {
  if (p.type !== "physical" && p.stock === null) return { text: p.type === "digital" ? "Unlimited" : "By booking" };
  if (p.stock === null) return { text: "Not tracked" };
  if (p.stock <= 0) return { text: "Out of stock", tone: "danger" };
  return { text: `${p.stock} in stock${p.variantCount > 1 ? ` · ${p.variantCount} variants` : ""}`, ...(p.stock <= 5 ? { tone: "warning" as const } : {}) };
}

/** Products: every product in the store, with status tabs, search, bulk actions and spreadsheet import and export. */
export default function ProductsPage() {
  const ctx = useStore();
  const mod = moduleByKey("products");
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState<ProductType | "">("");
  const [data, setData] = useState<ProductList | undefined>();
  const [more, setMore] = useState<ProductSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const storeId = ctx?.store.id;

  const query = useCallback(
    (after?: string) => {
      const params = new URLSearchParams({ limit: "50" });
      if (tab !== "all") params.set("status", tab);
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);
      if (after) params.set("cursor", after);
      return `/api/v1/stores/${storeId}/products?${params.toString()}`;
    },
    [storeId, tab, q, type],
  );

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<ProductList>(query())
        .then((r) => {
          if (cancelled) return;
          setData(r);
          setMore([]);
          setCursor(r.nextCursor);
          setSelected([]);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeId, query]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const manage = can("products.manage");
  const items = [...(data?.items ?? []), ...more];
  const total = data ? data.counts.active + data.counts.draft : undefined;
  const allSelected = items.length > 0 && selected.length === items.length;

  /** Reloads the first page after a change (bulk action, import). */
  async function refresh() {
    try {
      const r = await api<ProductList>(query());
      setData(r);
      setMore([]);
      setCursor(r.nextCursor);
      setSelected([]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<ProductList>(query(cursor));
      setMore((m) => [...m, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function bulk(action: "activate" | "draft" | "archive" | "delete") {
    if (action === "delete" && !window.confirm(`Delete ${selected.length} product${selected.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setStatus(undefined);
    try {
      const r = await api<{ changed: number }>(`/api/v1/stores/${store.id}/products/bulk`, { method: "POST", body: { ids: selected, action } });
      const verb = { activate: "activated", draft: "set to draft", archive: "archived", delete: "deleted" }[action];
      setStatus(`${r.changed} product${r.changed === 1 ? "" : "s"} ${verb}.`);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const empty = data && total === 0 && data.counts.archived === 0 && !q && !type;

  return (
    <Page>
      <PageHeader
        title={mod.label}
        eyebrow={mod.group}
        subtitle={mod.summary}
        actions={
          <>
            <a className="c-btn" href={`/api/v1/stores/${store.id}/products/export.csv`} download>
              <DownloadIcon size={16} /> Export
            </a>
            {manage && (
              <button type="button" className="c-btn" onClick={() => setImporting(true)}>
                <UploadIcon size={16} /> Import
              </button>
            )}
            {manage && (
              <a className="c-btn c-btn-primary" href={`${base}/products/new`}>
                <PlusIcon size={16} /> Add product
              </a>
            )}
          </>
        }
      />

      {importing && <ImportDialog storeId={store.id} onClose={() => setImporting(false)} onImported={() => void refresh()} />}

      {empty ? (
        <EmptyState
          icon={<ProductIcon size={26} />}
          title="Add your first product"
          actions={
            manage && (
              <>
                <a className="c-btn c-btn-primary" href={`${base}/products/new`}>
                  <PlusIcon size={16} /> Add product
                </a>
                <button type="button" className="c-btn" onClick={() => setImporting(true)}>
                  <UploadIcon size={16} /> Import a spreadsheet
                </button>
              </>
            )
          }
        >
          Sell physical goods, digital downloads or bookable services. Add photos, set prices for each size or colour, and track stock.
        </EmptyState>
      ) : (
        <>
          <nav className="c-tabs" aria-label="Product status">
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
                {data && <span className="c-muted"> {t.key === "all" ? total : data.counts[t.key]}</span>}
              </a>
            ))}
          </nav>
          <div className="c-toolbar">
            <div className="c-search">
              <SearchIcon size={16} />
              <input className="c-input" type="search" placeholder="Search title, SKU, tag or brand" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
            </div>
            <select className="c-select" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value as ProductType | "")} aria-label="Product type">
              <option value="">All types</option>
              {(Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]).map((t) => (
                <option key={t} value={t}>
                  {PRODUCT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {status && (
            <p role="status" className="c-ok" style={{ marginBottom: 12 }}>
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          {manage && selected.length > 0 && (
            <div className="c-bulkbar" role="region" aria-label="Bulk actions">
              <strong>{selected.length} selected</strong>
              <button type="button" className="c-btn c-btn-sm" onClick={() => void bulk("activate")}>
                Set active
              </button>
              <button type="button" className="c-btn c-btn-sm" onClick={() => void bulk("draft")}>
                Set draft
              </button>
              <button type="button" className="c-btn c-btn-sm" onClick={() => void bulk("archive")}>
                Archive
              </button>
              <button type="button" className="c-btn c-btn-sm" onClick={() => void bulk("delete")}>
                Delete
              </button>
            </div>
          )}

          <div className="c-table-wrap">
            <table className="c-table c-table-stack">
              <caption className="c-visually-hidden">Products</caption>
              <thead>
                <tr>
                  {manage && (
                    <th scope="col" style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        className="c-check-input"
                        aria-label="Select all"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? [] : items.map((p) => p.id))}
                      />
                    </th>
                  )}
                  <th scope="col">Product</th>
                  <th scope="col">Status</th>
                  <th scope="col">Type</th>
                  <th scope="col">Inventory</th>
                  <th scope="col" className="c-num">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {data === undefined ? (
                  [1, 2, 3].map((i) => (
                    <tr key={i}>
                      <td colSpan={manage ? 6 : 5}>
                        <div className="c-skeleton" role="status" aria-label="Loading products" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={manage ? 6 : 5} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                      No products match. Try another search or tab.
                    </td>
                  </tr>
                ) : (
                  items.map((p) => {
                    const stock = stockText(p);
                    return (
                      <tr key={p.id}>
                        {manage && (
                          <td>
                            <input
                              type="checkbox"
                              className="c-check-input"
                              aria-label={`Select ${p.title}`}
                              checked={selected.includes(p.id)}
                              onChange={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                            />
                          </td>
                        )}
                        <td data-label="Product">
                          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <Thumb mediaId={p.imageId} alt="" />
                            <span style={{ minWidth: 0 }}>
                              <a className="c-cell-title" href={`${base}/products/${p.id}`}>
                                {p.title}
                              </a>
                              <span className="c-cell-sub">{p.vendor ?? `/${p.handle}`}</span>
                            </span>
                          </span>
                        </td>
                        <td data-label="Status">
                          <Badge tone={STATUS_TONES[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                        </td>
                        <td data-label="Type">{PRODUCT_TYPE_LABELS[p.type]}</td>
                        <td data-label="Inventory" style={stock.tone ? { color: `var(--we-color-${stock.tone})`, fontWeight: 600 } : undefined}>
                          {stock.text}
                        </td>
                        <td data-label="Price" className="c-num">
                          {formatPriceRange(p.priceMin, p.priceMax, store.currency)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {cursor && (
            <div className="c-pager">
              <button type="button" className="c-btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
