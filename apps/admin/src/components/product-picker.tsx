"use client";

import { useEffect, useState } from "react";
import { formatPriceRange } from "@workeasy/commerce";
import { SearchIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, errorMessage } from "../lib/api";
import type { ProductList, ProductSummary } from "../lib/catalog";
import { Thumb } from "./media";

/**
 * Choose products, for a manual collection. Render it only while open so
 * each opening starts from `initial`.
 */
export function ProductPicker({
  storeId,
  currency,
  onClose,
  onPick,
  initial,
}: {
  storeId: string;
  currency: string;
  onClose: () => void;
  onPick: (products: ProductSummary[]) => void;
  initial: ProductSummary[];
}) {
  const [items, setItems] = useState<ProductSummary[] | undefined>();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ProductSummary[]>(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api<ProductList>(`/api/v1/stores/${storeId}/products?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => {
          if (!cancelled) setItems(r.items);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeId, q]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: ProductSummary) => setPicked((list) => (isPicked(p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));

  return (
    <Dialog
      open
      onClose={onClose}
      title="Choose products"
      wide
      footer={
        <>
          <span className="c-muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 14 }}>
            {picked.length} selected
          </span>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="c-btn c-btn-primary"
            onClick={() => {
              onPick(picked);
              onClose();
            }}
          >
            Done
          </button>
        </>
      }
    >
      <div className="c-search" style={{ maxWidth: "none" }}>
        <SearchIcon size={16} />
        <input className="c-input" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
      </div>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      <div className="c-table-wrap" style={{ boxShadow: "none" }}>
        <table className="c-table c-table-compact">
          <caption className="c-visually-hidden">Products</caption>
          <tbody>
            {items === undefined ? (
              <tr>
                <td>
                  <div className="c-skeleton" role="status" aria-label="Loading products" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="c-muted">No products match.</td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} data-clickable onClick={() => toggle(p)}>
                  <td style={{ width: 40 }}>
                    <input type="checkbox" className="c-check-input" checked={isPicked(p.id)} onChange={() => toggle(p)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${p.title}`} />
                  </td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Thumb mediaId={p.imageId} size="sm" />
                      <span className="c-cell-title">{p.title}</span>
                    </span>
                  </td>
                  <td className="c-num">{formatPriceRange(p.priceMin, p.priceMax, currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
