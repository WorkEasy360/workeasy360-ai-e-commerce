"use client";

import { useEffect, useState } from "react";
import { Badge, CollectionIcon, EmptyState, Page, PageHeader, PlusIcon, SearchIcon } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../lib/api";
import type { Collection } from "../../../../lib/catalog";
import { moduleByKey } from "../../../../lib/modules";
import { Thumb } from "../../../../components/media";
import { useStore } from "../store-shell";

/** Collections: hand-picked groups and rule-based ones, with how many products each holds. */
export default function CollectionsPage() {
  const ctx = useStore();
  const mod = moduleByKey("collections");
  const [items, setItems] = useState<Collection[] | undefined>();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ items: Collection[] }>(`/api/v1/stores/${storeId}/collections${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
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

  if (!ctx) return null;
  const { base, can } = ctx;
  const manage = can("products.manage");
  const add = manage && (
    <a className="c-btn c-btn-primary" href={`${base}/collections/new`}>
      <PlusIcon size={16} /> Create collection
    </a>
  );

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} actions={add} />
      {items && items.length === 0 && !q ? (
        <EmptyState icon={<CollectionIcon size={26} />} title="Group your products" actions={add}>
          Build menus like &ldquo;New arrivals&rdquo; or &ldquo;Under ₹499&rdquo;. Pick products by hand, or set rules and let products join automatically.
        </EmptyState>
      ) : (
        <>
          <div className="c-toolbar">
            <div className="c-search">
              <SearchIcon size={16} />
              <input className="c-input" type="search" placeholder="Search collections" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search collections" />
            </div>
          </div>
          {error && (
            <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <div className="c-table-wrap">
            <table className="c-table c-table-stack">
              <caption className="c-visually-hidden">Collections</caption>
              <thead>
                <tr>
                  <th scope="col">Collection</th>
                  <th scope="col">Type</th>
                  <th scope="col">Visibility</th>
                  <th scope="col" className="c-num">
                    Products
                  </th>
                </tr>
              </thead>
              <tbody>
                {items === undefined ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="c-skeleton" role="status" aria-label="Loading collections" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                      No collections match.
                    </td>
                  </tr>
                ) : (
                  items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Collection">
                        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <Thumb mediaId={c.imageId} />
                          <span>
                            <a className="c-cell-title" href={`${base}/collections/${c.id}`}>
                              {c.title}
                            </a>
                            <span className="c-cell-sub">/c/{c.handle}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Type">{c.kind === "automated" ? <Badge tone="info">Automated</Badge> : <Badge>Hand-picked</Badge>}</td>
                      <td data-label="Visibility">{c.published ? <Badge tone="success">Visible</Badge> : <Badge>Hidden</Badge>}</td>
                      <td data-label="Products" className="c-num">
                        {c.productCount ?? 0}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
