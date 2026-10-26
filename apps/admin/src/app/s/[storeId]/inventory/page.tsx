"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { variantTitle } from "@workeasy/commerce";
import { EmptyState, HistoryIcon, InventoryIcon, Page, PageHeader, SearchIcon, StatCard } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, errorMessage } from "../../../../lib/api";
import type { InventoryRow, Movement } from "../../../../lib/catalog";
import { moduleByKey } from "../../../../lib/modules";
import { Thumb } from "../../../../components/media";
import { useStore } from "../store-shell";

type Filter = "all" | "low" | "out";
interface InventoryPage {
  items: InventoryRow[];
  summary: { tracked: number; low: number; out: number };
  nextCursor?: string;
}

const REASONS: Record<string, string> = {
  initial: "Opening stock",
  received: "Received",
  correction: "Correction",
  damaged: "Damaged or lost",
  returned: "Returned",
  sold: "Sold",
  import: "Spreadsheet import",
};

function rowName(r: InventoryRow): string {
  return r.options.length ? `${r.productTitle} · ${variantTitle(r.options)}` : r.productTitle;
}

/** Changes one variant's stock: add or remove some, or set the count, always with a reason. */
function AdjustDialog({ storeId, row, onClose, onDone }: { storeId: string; row: InventoryRow; onClose: () => void; onDone: (onHand: number) => void }) {
  const ids = { qty: useId(), reason: useId(), note: useId(), threshold: useId() };
  const [mode, setMode] = useState<"add" | "set">("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("received");
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState(row.lowStockThreshold === null ? "" : String(row.lowStockThreshold));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const n = Number(quantity);
  const valid = quantity.trim() !== "" && Number.isInteger(n) && (mode === "set" ? n >= 0 : n !== 0);
  const result = valid ? (mode === "add" ? row.onHand + n : n) : undefined;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      let onHand = row.onHand;
      if (valid) {
        const r = await api<{ onHand: number }>(`/api/v1/stores/${storeId}/inventory/${row.variantId}/adjust`, { method: "POST", body: { mode, quantity: n, reason, note: note.trim() || null } });
        onHand = r.onHand;
      }
      const t = threshold.trim() === "" ? null : Number(threshold);
      if (t !== row.lowStockThreshold) await api(`/api/v1/stores/${storeId}/inventory/${row.variantId}/threshold`, { method: "PUT", body: { lowStockThreshold: t } });
      onDone(onHand);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const thresholdChanged = (threshold.trim() === "" ? null : Number(threshold)) !== row.lowStockThreshold;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Adjust stock"
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || (!valid && !thresholdChanged)} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontWeight: 600 }}>{rowName(row)}</p>
      <dl className="c-kv">
        <dt>On hand</dt>
        <dd>{row.onHand}</dd>
        <dt>Held in checkouts</dt>
        <dd>{row.reserved}</dd>
      </dl>
      <div className="c-segmented" role="group" aria-label="Adjustment">
        <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")}>
          Add or remove
        </button>
        <button type="button" aria-pressed={mode === "set"} onClick={() => setMode("set")}>
          Set count
        </button>
      </div>
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={ids.qty}>
            {mode === "add" ? "Quantity (negative to remove)" : "New count"}
          </label>
          <input id={ids.qty} className="c-input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={mode === "add" ? "+10" : String(row.onHand)} />
          {result !== undefined && <p className="c-hint">On hand after: {result}</p>}
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={ids.reason}>
            Reason
          </label>
          <select id={ids.reason} className="c-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {["received", "correction", "damaged", "returned"].map((r) => (
              <option key={r} value={r}>
                {REASONS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={ids.note}>
          Note <small>(optional)</small>
        </label>
        <input id={ids.note} className="c-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: supplier invoice #1042" />
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={ids.threshold}>
          Low-stock alert at <small>(optional)</small>
        </label>
        <input id={ids.threshold} className="c-input" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="5" />
        <p className="c-hint">Flag this variant as low when available stock falls to this number. Blank uses 5.</p>
      </div>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function HistoryDrawer({ storeId, row, onClose }: { storeId: string; row: InventoryRow; onClose: () => void }) {
  const [movements, setMovements] = useState<Movement[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    api<{ movements: Movement[] }>(`/api/v1/stores/${storeId}/inventory/${row.variantId}/movements`)
      .then((r) => setMovements(r.movements))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, row.variantId]);
  return (
    <Dialog open side onClose={onClose} title="Stock history">
      <p style={{ margin: 0, fontWeight: 600 }}>{rowName(row)}</p>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {movements === undefined ? (
        <div className="c-skeleton" role="status" aria-label="Loading history" />
      ) : movements.length === 0 ? (
        <p className="c-muted">No changes recorded yet.</p>
      ) : (
        <ol className="c-checklist">
          {movements.map((m) => (
            <li key={m.id} style={{ alignItems: "flex-start" }}>
              <span className={m.delta > 0 ? "c-delta-pos" : "c-delta-neg"} style={{ minWidth: 44, textAlign: "right" }}>
                {m.delta > 0 ? `+${m.delta}` : m.delta}
              </span>
              <div>
                <strong>
                  {REASONS[m.reason] ?? m.reason} · {m.onHandAfter} on hand
                </strong>
                <span>
                  {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {m.actorName ? ` · ${m.actorName}` : ""}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

/** Inventory: available stock for every tracked variant, with adjustments and history. */
export default function InventoryPage() {
  const ctx = useStore();
  const mod = moduleByKey("inventory");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<InventoryPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [adjusting, setAdjusting] = useState<InventoryRow | undefined>();
  const [history, setHistory] = useState<InventoryRow | undefined>();
  const storeId = ctx?.store.id;

  const url = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ filter, limit: "100" });
      if (q.trim()) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      return `/api/v1/stores/${storeId}/inventory?${params.toString()}`;
    },
    [storeId, filter, q],
  );

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<InventoryPage>(url())
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
  const { base, can, store } = ctx;
  const manage = can("inventory.manage");

  async function loadMore() {
    if (!data?.nextCursor) return;
    try {
      const page = await api<InventoryPage>(url(data.nextCursor));
      setData({ ...page, items: [...data.items, ...page.items] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const refresh = () => api<InventoryPage>(url()).then(setData, (err: unknown) => setError(errorMessage(err)));
  const nothingTracked = data && data.summary.tracked === 0;

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
      {nothingTracked ? (
        <EmptyState
          icon={<InventoryIcon size={26} />}
          title="No stock to track yet"
          actions={
            <a className="c-btn c-btn-primary" href={`${base}/products/new`}>
              Add a product
            </a>
          }
        >
          Physical products track stock per variant. Digital downloads and services don&apos;t need it.
        </EmptyState>
      ) : (
        <>
          <div className="c-stats" style={{ marginBottom: 20 }}>
            <StatCard label="Tracked variants" value={data?.summary.tracked ?? "—"} />
            <StatCard label="Low stock" value={data?.summary.low ?? "—"} foot="At or below their alert level" />
            <StatCard label="Out of stock" value={data?.summary.out ?? "—"} foot="Nothing available to sell" />
          </div>
          <nav className="c-tabs" aria-label="Stock filter">
            {(
              [
                ["all", "All"],
                ["low", "Low stock"],
                ["out", "Out of stock"],
              ] as const
            ).map(([key, label]) => (
              <a
                key={key}
                href="#"
                aria-current={filter === key ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setFilter(key);
                }}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="c-toolbar">
            <div className="c-search">
              <SearchIcon size={16} />
              <input className="c-input" type="search" placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" />
            </div>
          </div>
          {error && (
            <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <div className="c-table-wrap">
            <table className="c-table c-table-stack">
              <caption className="c-visually-hidden">Stock by variant</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col" className="c-num">
                    Available
                  </th>
                  <th scope="col" className="c-num">
                    On hand
                  </th>
                  <th scope="col">
                    <span className="c-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data === undefined ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="c-skeleton" role="status" aria-label="Loading stock" />
                    </td>
                  </tr>
                ) : data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                      {filter === "all" ? "No variants match." : filter === "low" ? "Nothing is running low." : "Nothing is out of stock."}
                    </td>
                  </tr>
                ) : (
                  data.items.map((r) => {
                    const low = r.available > 0 && r.available <= (r.lowStockThreshold ?? 5);
                    return (
                      <tr key={r.variantId}>
                        <td data-label="Product">
                          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <Thumb mediaId={r.imageId} size="sm" />
                            <span>
                              <a className="c-cell-title" href={`${base}/products/${r.productId}`}>
                                {r.productTitle}
                              </a>
                              <span className="c-cell-sub">{r.options.length ? variantTitle(r.options) : r.productStatus === "draft" ? "Draft" : " "}</span>
                            </span>
                          </span>
                        </td>
                        <td data-label="SKU" className="c-mono">
                          {r.sku ?? "—"}
                        </td>
                        <td data-label="Available" className="c-num" style={r.available <= 0 ? { color: "var(--we-color-danger)", fontWeight: 700 } : low ? { color: "var(--we-color-warning)", fontWeight: 700 } : undefined}>
                          {r.available}
                        </td>
                        <td data-label="On hand" className="c-num">
                          {r.onHand}
                          {r.reserved > 0 && <span className="c-cell-sub">{r.reserved} held</span>}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button type="button" className="c-btn c-btn-ghost c-btn-sm" onClick={() => setHistory(r)} aria-label={`Stock history for ${rowName(r)}`}>
                            <HistoryIcon size={15} />
                          </button>
                          {manage && (
                            <button type="button" className="c-btn c-btn-sm" onClick={() => setAdjusting(r)}>
                              Adjust
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
        </>
      )}
      {adjusting && <AdjustDialog storeId={store.id} row={adjusting} onClose={() => setAdjusting(undefined)} onDone={() => void refresh()} />}
      {history && <HistoryDrawer storeId={store.id} row={history} onClose={() => setHistory(undefined)} />}
    </Page>
  );
}
