"use client";

import { useEffect, useId, useState } from "react";
import { formatPriceRange, handleize, parseMoney, RULE_FIELD_LABELS, RULE_FIELDS, RULE_OPERATOR_LABELS, RULE_OPERATORS, ruleProblems, toDecimalString, type RuleField, type RuleOperator } from "@workeasy/commerce";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, Card, CloseIcon, Page, PageHeader, PlusIcon, TrashIcon } from "@workeasy/ui/react";
import { api, ApiError, errorMessage } from "../../../../lib/api";
import type { Collection, CollectionRules, MediaAsset, ProductSummary } from "../../../../lib/catalog";
import { MediaPicker, Thumb } from "../../../../components/media";
import { ProductPicker } from "../../../../components/product-picker";
import { useStore } from "../store-shell";

type Kind = "manual" | "automated";
type Condition = CollectionRules["conditions"][number];

interface Form {
  title: string;
  handle: string;
  description: string;
  kind: Kind;
  match: "all" | "any";
  conditions: Condition[];
  sortOrder: Collection["sortOrder"];
  imageId: string | null;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
  products: ProductSummary[];
}

const SORTS: Array<{ value: Collection["sortOrder"]; label: string; manualOnly?: boolean }> = [
  { value: "manual", label: "In the order I choose", manualOnly: true },
  { value: "newest", label: "Newest first" },
  { value: "title", label: "Title, A–Z" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
];

const blank: Form = {
  title: "",
  handle: "",
  description: "",
  kind: "manual",
  match: "all",
  conditions: [{ field: "tag", operator: "equals", value: "" }],
  sortOrder: "manual",
  imageId: null,
  published: true,
  seoTitle: "",
  seoDescription: "",
  products: [],
};

/** Rule values as the form shows them: prices in major units, the rest as typed. */
function rulesFromForm(form: Form, currency: string): CollectionRules {
  return {
    match: form.match,
    conditions: form.conditions.map((c) => (c.field === "price" ? { ...c, value: String(parseMoney(c.value, currency) ?? "") } : { ...c, value: c.value.trim() })),
  };
}

export function CollectionEditor({ collectionId }: { collectionId?: string }) {
  const ctx = useStore();
  const ids = { title: useId(), desc: useId(), handle: useId(), seoT: useId(), seoD: useId(), sort: useId() };
  const [form, setForm] = useState<Form | undefined>(collectionId ? undefined : blank);
  const [saved, setSaved] = useState<string>(JSON.stringify(blank));
  const [preview, setPreview] = useState<{ count: number; products: ProductSummary[] } | undefined>();
  const [picking, setPicking] = useState<"products" | "image" | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [handleTouched, setHandleTouched] = useState(Boolean(collectionId));
  const storeId = ctx?.store.id;
  const currency = ctx?.store.currency ?? "INR";

  useEffect(() => {
    if (!storeId || !collectionId) return;
    api<{ collection: Collection; products: ProductSummary[] }>(`/api/v1/stores/${storeId}/collections/${collectionId}`)
      .then(({ collection: c, products }) => {
        const loaded: Form = {
          title: c.title,
          handle: c.handle,
          description: c.description,
          kind: c.kind,
          match: c.rules?.match ?? "all",
          conditions: c.rules?.conditions.map((x) => (x.field === "price" ? { ...x, value: toDecimalString(Number(x.value), currency) } : x)) ?? blank.conditions,
          sortOrder: c.sortOrder,
          imageId: c.imageId,
          published: c.published,
          seoTitle: c.seoTitle ?? "",
          seoDescription: c.seoDescription ?? "",
          products: c.kind === "manual" ? products : [],
        };
        setForm(loaded);
        setSaved(JSON.stringify(loaded));
        if (c.kind === "automated") setPreview({ count: products.length, products });
      })
      .catch((err: unknown) => setProblems([errorMessage(err)]));
  }, [storeId, collectionId, currency]);

  // Live preview of what the rules match.
  const rulesKey = form?.kind === "automated" ? JSON.stringify([form.match, form.conditions]) : "";
  useEffect(() => {
    if (!storeId || !form || form.kind !== "automated") return;
    const rules = rulesFromForm(form, currency);
    if (ruleProblems(rules).length > 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ count: number; products: ProductSummary[] }>(`/api/v1/stores/${storeId}/collections/preview`, { method: "POST", body: { rules } })
        .then((r) => {
          if (!cancelled) setPreview(r);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // rulesKey captures exactly the parts of the form that change the preview.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [storeId, rulesKey, currency]);

  const dirty = form !== undefined && JSON.stringify(form) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const manage = can("products.manage");
  if (!form) {
    return (
      <Page>
        {problems.length > 0 ? (
          <p role="alert" className="c-error">
            {problems[0]}
          </p>
        ) : (
          <div className="c-skeleton" role="status" aria-label="Loading collection" style={{ width: 240, height: 26 }} />
        )}
      </Page>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setStatus(undefined);
  };
  const setCondition = (i: number, patch: Partial<Condition>) => set("conditions", form.conditions.map((c, n) => (n === i ? { ...c, ...patch } : c)));

  async function save() {
    if (!form || !storeId) return;
    const issues: string[] = [];
    if (!form.title.trim()) issues.push("Enter a title");
    const rules = form.kind === "automated" ? rulesFromForm(form, currency) : null;
    if (rules) issues.push(...ruleProblems(rules));
    setProblems(issues);
    if (issues.length > 0) return;
    const body = {
      title: form.title.trim(),
      handle: form.handle.trim(),
      description: form.description,
      kind: form.kind,
      rules,
      sortOrder: form.kind === "automated" && form.sortOrder === "manual" ? "newest" : form.sortOrder,
      imageId: form.imageId,
      published: form.published,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
      productIds: form.kind === "manual" ? form.products.map((p) => p.id) : [],
    };
    setBusy(true);
    try {
      if (collectionId) {
        await api(`/api/v1/stores/${storeId}/collections/${collectionId}`, { method: "PUT", body });
        setSaved(JSON.stringify(form));
        setStatus("Saved.");
      } else {
        const r = await api<{ collection: Collection }>(`/api/v1/stores/${storeId}/collections`, { method: "POST", body });
        setSaved(JSON.stringify(form));
        window.location.assign(`${base}/collections/${r.collection.id}`);
      }
    } catch (err) {
      setProblems(err instanceof ApiError && err.problem.errors ? err.problem.errors.map((e) => e.message) : [errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!collectionId || !window.confirm(`Delete "${form?.title}"? Its products stay in your catalog.`)) return;
    try {
      await api(`/api/v1/stores/${store.id}/collections/${collectionId}`, { method: "DELETE" });
      setSaved(JSON.stringify(form));
      window.location.assign(`${base}/collections`);
    } catch (err) {
      setProblems([errorMessage(err)]);
    }
  }

  const move = (i: number, j: number) => {
    const next = [...form.products];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set("products", next);
  };

  return (
    <Page>
      <a className="c-back" href={`${base}/collections`}>
        <ArrowLeftIcon size={14} /> Collections
      </a>
      <PageHeader
        title={collectionId ? form.title || "Untitled collection" : "Create collection"}
        eyebrow="Catalog"
        subtitle={collectionId ? `/c/${form.handle}` : "Group products for your storefront's menus and pages."}
        actions={
          collectionId &&
          manage && (
            <button type="button" className="c-btn c-btn-danger" onClick={() => void remove()}>
              <TrashIcon size={16} /> Delete
            </button>
          )
        }
      />
      <div className="c-detail">
        <div className="c-detail-main">
          <Card title="Details">
            <div className="c-form">
              <div className="c-field">
                <label className="c-label" htmlFor={ids.title}>
                  Title
                </label>
                <input
                  id={ids.title}
                  className="c-input"
                  value={form.title}
                  maxLength={200}
                  disabled={!manage}
                  placeholder="For example: New arrivals"
                  onChange={(e) => {
                    const title = e.target.value;
                    setForm((f) => (f ? { ...f, title, ...(handleTouched ? {} : { handle: handleize(title) }) } : f));
                  }}
                />
              </div>
              <div className="c-field">
                <label className="c-label" htmlFor={ids.desc}>
                  Description <small>(optional)</small>
                </label>
                <textarea id={ids.desc} className="c-textarea" rows={3} value={form.description} maxLength={5000} disabled={!manage} onChange={(e) => set("description", e.target.value)} />
              </div>
            </div>
          </Card>

          <Card title="How products join">
            <div className="c-radio-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {(
                [
                  ["manual", "Hand-picked", "Choose each product and its order."],
                  ["automated", "Automated", "Products that match your conditions join, now and later."],
                ] as const
              ).map(([kind, label, help]) => (
                <label key={kind} className="c-radio-card">
                  <input
                    type="radio"
                    name="ckind"
                    className="c-check-input"
                    checked={form.kind === kind}
                    disabled={!manage || Boolean(collectionId)}
                    onChange={() => setForm({ ...form, kind, sortOrder: kind === "automated" ? "newest" : "manual" })}
                  />
                  <span>
                    <strong>{label}</strong>
                    <span>{help}</span>
                  </span>
                </label>
              ))}
            </div>
            {collectionId && <p className="c-hint" style={{ marginTop: 8 }}>To switch type, create a new collection.</p>}

            {form.kind === "automated" && (
              <div className="c-form" style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
                  Products must match
                  <div className="c-segmented" role="group" aria-label="Match">
                    <button type="button" aria-pressed={form.match === "all"} disabled={!manage} onClick={() => set("match", "all")}>
                      all conditions
                    </button>
                    <button type="button" aria-pressed={form.match === "any"} disabled={!manage} onClick={() => set("match", "any")}>
                      any condition
                    </button>
                  </div>
                </div>
                {form.conditions.map((c, i) => (
                  <div key={i} className="c-rule-row">
                    <select
                      className="c-select"
                      aria-label={`Condition ${i + 1} field`}
                      value={c.field}
                      disabled={!manage}
                      onChange={(e) => {
                        const field = e.target.value as RuleField;
                        setCondition(i, { field, operator: RULE_OPERATORS[field][0]!, value: field === "type" ? "physical" : "" });
                      }}
                    >
                      {RULE_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {RULE_FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                    <select className="c-select" aria-label={`Condition ${i + 1} operator`} value={c.operator} disabled={!manage} onChange={(e) => setCondition(i, { operator: e.target.value as RuleOperator })}>
                      {RULE_OPERATORS[c.field].map((op) => (
                        <option key={op} value={op}>
                          {RULE_OPERATOR_LABELS[op]}
                        </option>
                      ))}
                    </select>
                    {c.field === "type" ? (
                      <select className="c-select" aria-label={`Condition ${i + 1} value`} value={c.value} disabled={!manage} onChange={(e) => setCondition(i, { value: e.target.value })}>
                        <option value="physical">Physical</option>
                        <option value="digital">Digital download</option>
                        <option value="service">Service / booking</option>
                      </select>
                    ) : c.field === "price" ? (
                      <span className="c-input-group">
                        <span>{currency}</span>
                        <input className="c-input" inputMode="decimal" aria-label={`Condition ${i + 1} value`} value={c.value} disabled={!manage} onChange={(e) => setCondition(i, { value: e.target.value })} />
                      </span>
                    ) : (
                      <input className="c-input" aria-label={`Condition ${i + 1} value`} value={c.value} maxLength={200} disabled={!manage} onChange={(e) => setCondition(i, { value: e.target.value })} />
                    )}
                    <button
                      type="button"
                      className="c-btn c-btn-ghost c-btn-icon"
                      aria-label={`Remove condition ${i + 1}`}
                      disabled={!manage || form.conditions.length === 1}
                      onClick={() => set("conditions", form.conditions.filter((_, n) => n !== i))}
                    >
                      <CloseIcon size={16} />
                    </button>
                  </div>
                ))}
                {manage && form.conditions.length < 10 && (
                  <button type="button" className="c-btn c-btn-sm" style={{ justifySelf: "start" }} onClick={() => set("conditions", [...form.conditions, { field: "tag", operator: "equals", value: "" }])}>
                    <PlusIcon size={14} /> Add condition
                  </button>
                )}
              </div>
            )}
          </Card>

          <Card
            title={form.kind === "manual" ? `Products (${form.products.length})` : `Matching products${preview ? ` (${preview.count})` : ""}`}
            actions={
              form.kind === "manual" &&
              manage && (
                <button type="button" className="c-btn c-btn-sm" onClick={() => setPicking("products")}>
                  <PlusIcon size={14} /> Choose products
                </button>
              )
            }
          >
            {(() => {
              const list = form.kind === "manual" ? form.products : (preview?.products ?? []);
              if (list.length === 0) {
                return (
                  <p className="c-hint" style={{ fontSize: 14 }}>
                    {form.kind === "manual" ? "No products yet. Choose some to add them." : "No products match these conditions yet."}
                  </p>
                );
              }
              return (
                <ul className="c-checklist">
                  {list.map((p, i) => (
                    <li key={p.id}>
                      <Thumb mediaId={p.imageId} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <strong>{p.title}</strong>
                        <span>{formatPriceRange(p.priceMin, p.priceMax, currency)}</span>
                      </div>
                      {form.kind === "manual" && manage && (
                        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                          {form.sortOrder === "manual" && (
                            <>
                              <button type="button" className="c-btn c-btn-ghost c-btn-icon c-btn-sm" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                                <ArrowUpIcon size={14} />
                              </button>
                              <button type="button" className="c-btn c-btn-ghost c-btn-icon c-btn-sm" aria-label={`Move ${p.title} down`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                                <ArrowDownIcon size={14} />
                              </button>
                            </>
                          )}
                          <button type="button" className="c-btn c-btn-ghost c-btn-icon c-btn-sm" aria-label={`Remove ${p.title}`} onClick={() => set("products", form.products.filter((x) => x.id !== p.id))}>
                            <CloseIcon size={14} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
            {form.kind === "automated" && preview && preview.count > preview.products.length && (
              <p className="c-hint" style={{ marginTop: 8 }}>
                Showing {preview.products.length} of {preview.count}.
              </p>
            )}
          </Card>

          <Card title="Search engine listing">
            <div className="c-form">
              <div className="c-field">
                <label className="c-label" htmlFor={ids.handle}>
                  URL handle
                </label>
                <input
                  id={ids.handle}
                  className="c-input"
                  value={form.handle}
                  maxLength={100}
                  disabled={!manage}
                  onChange={(e) => {
                    setHandleTouched(true);
                    set("handle", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  }}
                />
              </div>
              <div className="c-field">
                <label className="c-label" htmlFor={ids.seoT}>
                  Page title
                </label>
                <input id={ids.seoT} className="c-input" value={form.seoTitle} placeholder={form.title} maxLength={120} disabled={!manage} onChange={(e) => set("seoTitle", e.target.value)} />
              </div>
              <div className="c-field">
                <label className="c-label" htmlFor={ids.seoD}>
                  Meta description
                </label>
                <textarea id={ids.seoD} className="c-textarea" rows={2} value={form.seoDescription} maxLength={320} disabled={!manage} onChange={(e) => set("seoDescription", e.target.value)} />
              </div>
            </div>
          </Card>
        </div>

        <div className="c-detail-side">
          <Card title="Visibility">
            <label className="c-inline-check">
              <input type="checkbox" className="c-check-input" checked={form.published} disabled={!manage} onChange={(e) => set("published", e.target.checked)} />
              Show on the storefront
            </label>
          </Card>
          <Card title="Sort products">
            <select id={ids.sort} className="c-select" aria-label="Sort products" value={form.sortOrder} disabled={!manage} onChange={(e) => set("sortOrder", e.target.value as Form["sortOrder"])}>
              {SORTS.filter((s) => form.kind === "manual" || !s.manualOnly).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Card>
          <Card
            title="Image"
            actions={
              manage && (
                <button type="button" className="c-btn c-btn-sm" onClick={() => setPicking("image")}>
                  {form.imageId ? "Change" : "Add"}
                </button>
              )
            }
          >
            {form.imageId ? (
              <div style={{ display: "grid", gap: 8 }}>
                <Thumb mediaId={form.imageId} size="lg" />
                {manage && (
                  <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => set("imageId", null)}>
                    Remove image
                  </button>
                )}
              </div>
            ) : (
              <p className="c-hint">Shown on collection pages and menus.</p>
            )}
          </Card>
        </div>
      </div>

      {manage && (
        <div className="c-savebar">
          <div className="c-status" role={problems.length ? "alert" : "status"}>
            {problems.length > 0 ? <span className="c-error">{problems[0]}</span> : status ? <span className="c-ok">{status}</span> : dirty ? <span className="c-muted">Unsaved changes</span> : null}
          </div>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || (!dirty && Boolean(collectionId))} onClick={() => void save()}>
            {busy ? "Saving…" : collectionId ? "Save" : "Save collection"}
          </button>
        </div>
      )}

      {picking === "products" && <ProductPicker storeId={store.id} currency={currency} initial={form.products} onClose={() => setPicking(undefined)} onPick={(products) => set("products", products)} />}
      {picking === "image" && (
        <MediaPicker
          storeId={store.id}
          open
          kind="media"
          title="Choose a collection image"
          initial={form.imageId ? [form.imageId] : []}
          onClose={() => setPicking(undefined)}
          onPick={(picked: string[], _assets: MediaAsset[]) => set("imageId", picked.at(-1) ?? null)}
        />
      )}
    </Page>
  );
}
