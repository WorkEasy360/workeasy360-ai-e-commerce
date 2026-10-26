"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Card, EmptyState, Page, PageHeader, ReviewIcon, SearchIcon } from "@workeasy/ui/react";
import { BarList } from "../../../../components/charts";
import { api, errorMessage } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

type Status = "pending" | "published" | "hidden";

interface Review {
  id: string;
  productId: string;
  productTitle: string;
  orderId: string;
  orderNumber: number;
  authorName: string;
  email: string;
  rating: number;
  title: string | null;
  body: string;
  status: Status;
  reply: string | null;
  createdAt: string;
}

interface ReviewPage {
  items: Review[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Status, number>;
  summary: { average: number | null; count: number; histogram: [number, number, number, number, number] };
}

const TABS: Array<{ key: Status; label: string }> = [
  { key: "pending", label: "To review" },
  { key: "published", label: "Published" },
  { key: "hidden", label: "Hidden" },
];

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="c-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewSettingsCard({ storeId }: { storeId: string }) {
  const id = useId();
  const [s, setS] = useState<{ autoPublish: boolean; requestAfterDays: number | null } | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    api<{ settings: { autoPublish: boolean; requestAfterDays: number | null } }>(`/api/v1/stores/${storeId}/review-settings`)
      .then((r) => setS(r.settings))
      .catch(() => undefined);
  }, [storeId]);

  async function save(next: { autoPublish: boolean; requestAfterDays: number | null }) {
    setS(next);
    try {
      await api(`/api/v1/stores/${storeId}/review-settings`, { method: "PUT", body: next });
      setStatus("Saved");
    } catch (err) {
      setStatus(errorMessage(err));
    }
  }

  if (!s) return null;
  return (
    <Card title="Settings">
      <label className="c-inline-check">
        <input type="checkbox" className="c-check-input" checked={s.autoPublish} onChange={(e) => void save({ ...s, autoPublish: e.target.checked })} />
        Publish 4 and 5 star reviews straight away
      </label>
      <p className="c-hint">Lower ratings always wait here for you to read first.</p>
      <label className="c-inline-check" style={{ marginTop: 8 }}>
        <input type="checkbox" className="c-check-input" checked={s.requestAfterDays !== null} onChange={(e) => void save({ ...s, requestAfterDays: e.target.checked ? 5 : null })} />
        Email buyers asking for a review
      </label>
      {s.requestAfterDays !== null && (
        <div className="c-field" style={{ marginTop: 8 }}>
          <label className="c-label" htmlFor={`${id}-days`}>
            Days after their order is fulfilled
          </label>
          <select id={`${id}-days`} className="c-select" style={{ maxWidth: 160 }} value={s.requestAfterDays} onChange={(e) => void save({ ...s, requestAfterDays: Number(e.target.value) })}>
            {[2, 3, 5, 7, 10, 14, 21, 30].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
      )}
      {status && (
        <p className="c-hint" role="status" style={{ marginBottom: 0 }}>
          {status}
        </p>
      )}
    </Card>
  );
}

/** Reviews: buyers' ratings waiting for a decision, what's live, and the store's rating overall. */
export function ReviewsView() {
  const ctx = useStore();
  const mod = moduleByKey("reviews");
  const [tab, setTab] = useState<Status>("pending");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ReviewPage | undefined>();
  const [replying, setReplying] = useState<string | undefined>();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  const load = useCallback(() => {
    if (!storeId) return;
    const params = new URLSearchParams({ status: tab });
    if (q.trim()) params.set("q", q.trim());
    api<ReviewPage>(`/api/v1/stores/${storeId}/reviews?${params.toString()}`)
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, tab, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!ctx) return null;
  const { store, base, can } = ctx;
  const manage = can("reviews.manage");

  async function update(r: Review, body: { status?: Status; reply?: string | null }) {
    try {
      await api(`/api/v1/stores/${store.id}/reviews/${r.id}`, { method: "PATCH", body });
      setReplying(undefined);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const summary = data?.summary;
  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      <div className="c-grid-2">
        <div>
          <nav className="c-tabs" aria-label="Review status">
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
              <input className="c-input" type="search" placeholder="Search reviews, products or names" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reviews" />
            </div>
          </div>
          {data === undefined ? (
            <div className="c-skeleton" role="status" aria-label="Loading reviews" style={{ height: 160 }} />
          ) : data.items.length === 0 ? (
            <EmptyState icon={<ReviewIcon size={26} />} title={tab === "pending" ? "Nothing waiting" : tab === "published" ? "No published reviews yet" : "No hidden reviews"}>
              {tab === "pending" ? "New reviews from buyers land here for you to publish or hide. Buyers can review from their order page, or from the email sent after delivery." : "Reviews you publish show on product pages."}
            </EmptyState>
          ) : (
            <Card flush>
              <div style={{ padding: "0 20px" }}>
                {data.items.map((r) => (
                  <article key={r.id} className="c-review" aria-label={`Review by ${r.authorName}`}>
                    <div className="c-review-head">
                      <Stars rating={r.rating} />
                      <strong>{r.title ?? (r.body ? "" : "Rating only")}</strong>
                      {manage && (
                        <span>
                          {r.status !== "published" && (
                            <button type="button" className="c-btn c-btn-sm c-btn-primary" onClick={() => void update(r, { status: "published" })}>
                              Publish
                            </button>
                          )}
                          {r.status !== "hidden" && (
                            <button type="button" className="c-btn c-btn-sm" onClick={() => void update(r, { status: "hidden" })}>
                              Hide
                            </button>
                          )}
                          <button
                            type="button"
                            className="c-btn c-btn-sm c-btn-ghost"
                            onClick={() => {
                              setReplying(r.id);
                              setReply(r.reply ?? "");
                            }}
                          >
                            {r.reply ? "Edit reply" : "Reply"}
                          </button>
                        </span>
                      )}
                    </div>
                    {r.body && <p style={{ margin: 0, whiteSpace: "pre-line" }}>{r.body}</p>}
                    <span className="c-cell-sub">
                      {r.authorName} · <a href={`${base}/products/${r.productId}`}>{r.productTitle}</a> · <a href={`${base}/orders/${r.orderId}`}>order #{r.orderNumber}</a> ·{" "}
                      {new Date(r.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                      {r.status === "published" && (
                        <>
                          {" "}
                          <Badge tone="success">Live</Badge>
                        </>
                      )}
                    </span>
                    {r.reply && replying !== r.id && (
                      <blockquote>
                        <strong>Your reply:</strong> {r.reply}
                      </blockquote>
                    )}
                    {replying === r.id && (
                      <div className="c-field" style={{ margin: 0 }}>
                        <label className="c-label" htmlFor={`reply-${r.id}`}>
                          Reply publicly as {store.name}
                        </label>
                        <textarea id={`reply-${r.id}`} className="c-textarea" rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button type="button" className="c-btn c-btn-sm c-btn-primary" onClick={() => void update(r, { reply: reply.trim() || null })}>
                            {reply.trim() ? "Save reply" : "Remove reply"}
                          </button>
                          <button type="button" className="c-btn c-btn-sm" onClick={() => setReplying(undefined)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Card title="Your rating">
            {summary && summary.count > 0 ? (
              <>
                <p style={{ margin: "0 0 12px", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="c-stat-value">{summary.average?.toFixed(1)}</span>
                  <Stars rating={Math.round(summary.average ?? 0)} />
                  <span className="c-muted">
                    from {summary.count} published review{summary.count === 1 ? "" : "s"}
                  </span>
                </p>
                <BarList
                  rows={summary.histogram.map((n, i) => ({ key: String(5 - i), label: `${5 - i} star${i === 4 ? "" : "s"}`, value: n }))}
                  format={(v) => String(v)}
                  color="var(--we-chart-3)"
                  empty=""
                />
              </>
            ) : (
              <p className="c-muted" style={{ margin: 0 }}>
                Your average appears once you publish reviews.
              </p>
            )}
          </Card>
          {manage && <ReviewSettingsCard storeId={store.id} />}
        </div>
      </div>
    </Page>
  );
}
