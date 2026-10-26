"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_HOURS, handleize, hoursProblems, optionProblems, parseMoney, syncVariants, toDecimalString, variantTitle, type WeeklyHours } from "@workeasy/commerce";
import { ArrowLeftIcon, ArrowRightIcon, Badge, Card, CloseIcon, FileIcon, Page, PageHeader, PlusIcon, TrashIcon } from "@workeasy/ui/react";
import { TagInput } from "@workeasy/ui/client";
import { api, errorMessage, ApiError, storefrontUrl } from "../../../../lib/api";
import { PRODUCT_TYPE_LABELS, type MediaAsset, type Product, type ProductStatus, type ProductType } from "../../../../lib/catalog";
import { HoursEditor } from "../../../../components/hours-editor";
import { MediaPicker, Thumb } from "../../../../components/media";
import { useStore } from "../store-shell";

/** A variant as the form holds it: amounts and counts as the text typed. */
interface VariantDraft {
  key: string;
  id?: string;
  options: string[];
  price: string;
  compareAt: string;
  cost: string;
  sku: string;
  barcode: string;
  weight: string;
  stock: string;
  /** Stock when loaded; saving sends stock only if it changed, so concurrent sales aren't overwritten. */
  loadedStock?: string;
  trackInventory: boolean;
  allowBackorder: boolean;
}

interface Form {
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  downloadLimit: string;
  downloadExpiryDays: string;
  bookingDuration: string;
  bookingNotice: string;
  bookingCapacity: string;
  bookingHours: WeeklyHours;
  /** Percent, blank for the store's rate. */
  taxRate: string;
  hasOptions: boolean;
  options: Array<{ name: string; values: string[] }>;
  variants: VariantDraft[];
  mediaIds: string[];
  fileIds: string[];
  collectionIds: string[];
}

let keySeq = 0;
const newKey = () => `v${++keySeq}`;

function blankVariant(type: ProductType, options: string[] = []): VariantDraft {
  return { key: newKey(), options, price: "", compareAt: "", cost: "", sku: "", barcode: "", weight: "", stock: "0", trackInventory: type === "physical", allowBackorder: false };
}

function blankForm(type: ProductType): Form {
  return {
    type,
    status: "draft",
    title: "",
    handle: "",
    description: "",
    vendor: "",
    tags: [],
    seoTitle: "",
    seoDescription: "",
    downloadLimit: "",
    downloadExpiryDays: "",
    bookingDuration: type === "service" ? "60" : "",
    bookingNotice: type === "service" ? "24" : "",
    bookingCapacity: type === "service" ? "1" : "",
    bookingHours: DEFAULT_HOURS,
    taxRate: "",
    hasOptions: false,
    options: [],
    variants: [blankVariant(type)],
    mediaIds: [],
    fileIds: [],
    collectionIds: [],
  };
}

function formFrom(p: Product, currency: string): Form {
  const money = (v: number | null) => (v === null ? "" : toDecimalString(v, currency));
  const num = (v: number | null) => (v === null ? "" : String(v));
  return {
    type: p.type,
    status: p.status,
    title: p.title,
    handle: p.handle,
    description: p.description,
    vendor: p.vendor ?? "",
    tags: p.tags,
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    downloadLimit: num(p.downloadLimit),
    downloadExpiryDays: num(p.downloadExpiryDays),
    bookingDuration: num(p.bookingDurationMinutes),
    bookingNotice: num(p.bookingNoticeHours),
    bookingCapacity: num(p.bookingCapacity),
    bookingHours: p.bookingHours ? ({ ...DEFAULT_HOURS, ...p.bookingHours } as WeeklyHours) : DEFAULT_HOURS,
    taxRate: p.taxRateBps === null ? "" : String(p.taxRateBps / 100),
    hasOptions: p.options.length > 0,
    options: p.options,
    variants: p.variants.map((v) => ({
      key: newKey(),
      id: v.id,
      options: v.options,
      price: money(v.priceMinor),
      compareAt: money(v.compareAtMinor),
      cost: money(v.costMinor),
      sku: v.sku ?? "",
      barcode: v.barcode ?? "",
      weight: num(v.weightGrams),
      stock: String(v.onHand),
      loadedStock: String(v.onHand),
      trackInventory: v.trackInventory,
      allowBackorder: v.allowBackorder,
    })),
    mediaIds: p.mediaIds,
    fileIds: p.fileIds,
    collectionIds: p.collectionIds,
  };
}

/** Turns the form into the API body, or explains what to fix. */
function toBody(form: Form, currency: string): { body?: unknown; problems: string[] } {
  const problems: string[] = [];
  const int = (label: string, value: string, opts: { min?: number; required?: boolean } = {}): number | null => {
    if (value.trim() === "") {
      if (opts.required) problems.push(`Enter ${label}`);
      return null;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < (opts.min ?? 0)) {
      problems.push(`${label[0]!.toUpperCase()}${label.slice(1)} must be a whole number`);
      return null;
    }
    return n;
  };
  if (!form.title.trim()) problems.push("Enter a title");
  const taxRateBps = (): number | null => {
    if (form.taxRate.trim() === "") return null;
    const bps = Math.round(Number(form.taxRate) * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
      problems.push("Enter a tax rate between 0 and 50%");
      return null;
    }
    return bps;
  };
  if (form.type === "service") problems.push(...hoursProblems(form.bookingHours));
  const options = form.hasOptions ? form.options.map((o) => ({ name: o.name.trim(), values: o.values })) : [];
  problems.push(...optionProblems(options));
  const variants = form.variants.map((v) => {
    const name = form.hasOptions ? variantTitle(v.options) : "the product";
    const price = parseMoney(v.price, currency);
    if (price === undefined) problems.push(`Enter a price for ${name}`);
    const optionalMoney = (label: string, raw: string) => {
      if (!raw.trim()) return null;
      const parsed = parseMoney(raw, currency);
      if (parsed === undefined) problems.push(`${label} for ${name} isn't a valid amount`);
      return parsed ?? null;
    };
    const stock = v.trackInventory ? int(`stock for ${name}`, v.stock, { min: -1_000_000 }) : null;
    return {
      ...(v.id ? { id: v.id } : {}),
      options: form.hasOptions ? v.options : [],
      priceMinor: price ?? 0,
      compareAtMinor: optionalMoney("Compare-at price", v.compareAt),
      costMinor: optionalMoney("Cost", v.cost),
      sku: v.sku.trim() || null,
      barcode: v.barcode.trim() || null,
      weightGrams: form.type === "physical" ? int(`weight for ${name}`, v.weight) : null,
      trackInventory: v.trackInventory,
      allowBackorder: v.allowBackorder,
      // Unchanged stock is left alone, so sales made while editing aren't overwritten.
      stock: v.id && v.stock === v.loadedStock ? null : stock,
    };
  });
  const body = {
    type: form.type,
    status: form.status,
    title: form.title.trim(),
    handle: form.handle.trim(),
    description: form.description,
    vendor: form.vendor.trim() || null,
    tags: form.tags,
    seoTitle: form.seoTitle.trim() || null,
    seoDescription: form.seoDescription.trim() || null,
    downloadLimit: form.type === "digital" ? int("the download limit", form.downloadLimit, { min: 1 }) : null,
    downloadExpiryDays: form.type === "digital" ? int("the link lifetime", form.downloadExpiryDays, { min: 1 }) : null,
    bookingDurationMinutes: form.type === "service" ? int("the booking length", form.bookingDuration, { min: 5, required: true }) : null,
    bookingNoticeHours: form.type === "service" ? int("the notice period", form.bookingNotice) : null,
    bookingCapacity: form.type === "service" ? int("bookings per slot", form.bookingCapacity, { min: 1 }) : null,
    bookingHours: form.type === "service" ? form.bookingHours : null,
    taxRateBps: taxRateBps(),
    options,
    variants,
    mediaIds: form.mediaIds,
    fileIds: form.type === "digital" ? form.fileIds : [],
    collectionIds: form.collectionIds,
  };
  return problems.length > 0 ? { problems } : { body, problems };
}

function Field({ label, hint, children, id }: { label: ReactNode; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="c-hint">{hint}</p>}
    </div>
  );
}

const TYPE_HELP: Record<ProductType, string> = {
  physical: "Goods you ship or hand over. Track stock per size or colour.",
  digital: "Files buyers download after paying: e-books, music, templates.",
  service: "Appointments and sessions shoppers book for a date and time.",
};

/**
 * Creates or edits one product. Options (Size, Colour…) generate the variant
 * table; variants keep their price, SKU and stock when options change.
 */
export function ProductEditor({ productId }: { productId?: string }) {
  const ctx = useStore();
  const ids = { title: useId(), desc: useId(), handle: useId(), vendor: useId(), tags: useId(), seoT: useId(), seoD: useId(), status: useId(), type: useId() };
  // One blank form, so the saved snapshot matches it exactly (variant keys included).
  const [initial] = useState(() => (productId ? undefined : blankForm("physical")));
  const [form, setForm] = useState<Form | undefined>(initial);
  const [saved, setSaved] = useState<string | undefined>(initial ? JSON.stringify(initial) : undefined);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [collections, setCollections] = useState<Array<{ id: string; title: string }>>([]);
  const [picker, setPicker] = useState<"media" | "file" | undefined>();
  const [knownMedia, setKnownMedia] = useState<Record<string, MediaAsset>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [handleTouched, setHandleTouched] = useState(Boolean(productId));
  const storeId = ctx?.store.id;
  const currency = ctx?.store.currency ?? "INR";

  useEffect(() => {
    if (!storeId) return;
    api<{ items: Array<{ id: string; title: string }> }>(`/api/v1/stores/${storeId}/collections?kind=manual`)
      .then((r) => setCollections(r.items))
      .catch(() => setCollections([]));
    if (!productId) return;
    api<{ product: Product }>(`/api/v1/stores/${storeId}/products/${productId}`)
      .then((r) => {
        const loaded = formFrom(r.product, currency);
        setForm(loaded);
        setSaved(JSON.stringify(loaded));
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [storeId, productId, currency]);

  // Files need their names, which product data doesn't carry.
  useEffect(() => {
    if (!storeId || !form) return;
    const missing = form.fileIds.filter((id) => !knownMedia[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map((id) => api<{ media: MediaAsset }>(`/api/v1/stores/${storeId}/media/${id}`).then((r) => r.media)))
      .then((assets) => {
        if (!cancelled) setKnownMedia((k) => ({ ...k, ...Object.fromEntries(assets.map((a) => [a.id, a])) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeId, form, knownMedia]);

  const dirty = form !== undefined && saved !== undefined && JSON.stringify(form) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const optionIssues = useMemo(() => (form?.hasOptions ? optionProblems(form.options) : []), [form]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const manage = can("products.manage");
  if (loadError) {
    return (
      <Page>
        <a className="c-back" href={`${base}/products`}>
          <ArrowLeftIcon size={14} /> Products
        </a>
        <p role="alert" className="c-error">
          {loadError}
        </p>
      </Page>
    );
  }
  if (!form) {
    return (
      <Page>
        <div className="c-skeleton" role="status" aria-label="Loading product" style={{ width: 240, height: 26 }} />
      </Page>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setStatus(undefined);
  };
  const setVariant = (key: string, patch: Partial<VariantDraft>) => set("variants", form.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  /** Rebuilds variants for new options, keeping matching ones and copying the first variant's settings into new ones. */
  const applyOptions = (options: Form["options"], hasOptions = form.hasOptions) => {
    const first = form.variants[0] ?? blankVariant(form.type);
    const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
    const variants = hasOptions && usable.length > 0
      ? syncVariants(usable, form.variants, (values) => {
          // New combinations copy the first variant's prices but are new rows: no id, SKU or stock yet.
          const { id: _id, loadedStock: _stock, ...settings } = first;
          return { ...settings, key: newKey(), options: values, sku: "", barcode: "", stock: "0" };
        })
      : [{ ...first, options: [] }];
    setForm((f) => (f ? { ...f, hasOptions, options, variants } : f));
  };

  async function save() {
    if (!form || !storeId) return;
    const { body, problems: issues } = toBody(form, currency);
    setProblems(issues);
    setStatus(undefined);
    if (!body) return;
    setBusy(true);
    try {
      const r = productId
        ? await api<{ product: Product }>(`/api/v1/stores/${storeId}/products/${productId}`, { method: "PUT", body })
        : await api<{ product: Product }>(`/api/v1/stores/${storeId}/products`, { method: "POST", body });
      if (!productId) {
        setSaved(JSON.stringify(form));
        window.location.assign(`${base}/products/${r.product.id}?created=1`);
        return;
      }
      const next = formFrom(r.product, currency);
      setForm(next);
      setSaved(JSON.stringify(next));
      setStatus("Saved.");
    } catch (err) {
      setProblems(err instanceof ApiError && err.problem.errors ? err.problem.errors.map((e) => e.message) : [errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!productId || !window.confirm(`Delete "${form?.title}"? This can't be undone.`)) return;
    try {
      await api(`/api/v1/stores/${store.id}/products/${productId}`, { method: "DELETE" });
      setSaved(JSON.stringify(form));
      window.location.assign(`${base}/products`);
    } catch (err) {
      setProblems([errorMessage(err)]);
    }
  }

  const moneyInput = (value: string, onChange: (v: string) => void, label: string, placeholder = "0.00") => (
    <span className="c-input-group">
      <span>{currency}</span>
      <input className="c-input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} disabled={!manage} />
    </span>
  );
  const single = form.variants[0]!;
  const justCreated = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("created");

  return (
    <Page>
      <a className="c-back" href={`${base}/products`}>
        <ArrowLeftIcon size={14} /> Products
      </a>
      <PageHeader
        title={productId ? form.title || "Untitled product" : "Add product"}
        eyebrow={
          <>
            Catalog
            {productId && <Badge tone={form.status === "active" ? "success" : form.status === "archived" ? "warning" : "neutral"}>{form.status}</Badge>}
          </>
        }
        subtitle={productId ? `${PRODUCT_TYPE_LABELS[form.type]} · /${form.handle}` : "Describe what you sell, add photos, and set prices for each option."}
        actions={
          productId &&
          manage && (
            <button type="button" className="c-btn c-btn-danger" onClick={() => void remove()}>
              <TrashIcon size={16} /> Delete
            </button>
          )
        }
      />
      {justCreated && !status && !dirty && (
        <p role="status" className="c-ok" style={{ marginBottom: 12 }}>
          Product created.
        </p>
      )}

      <div className="c-detail">
        <div className="c-detail-main">
          {!productId && (
            <Card title="What are you selling?">
              <div className="c-radio-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", display: "grid" }}>
                {(Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]).map((t) => (
                  <label key={t} className="c-radio-card">
                    <input
                      type="radio"
                      name="ptype"
                      className="c-check-input"
                      checked={form.type === t}
                      onChange={() => {
                        const fresh = blankForm(t);
                        setForm({ ...form, type: t, bookingDuration: fresh.bookingDuration, bookingNotice: fresh.bookingNotice, bookingCapacity: fresh.bookingCapacity, variants: form.variants.map((v) => ({ ...v, trackInventory: t === "physical" })) });
                      }}
                    />
                    <span>
                      <strong>{PRODUCT_TYPE_LABELS[t]}</strong>
                      <span>{TYPE_HELP[t]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Card>
          )}

          <Card title="Details">
            <div className="c-form">
              <Field id={ids.title} label="Title">
                <input
                  id={ids.title}
                  className="c-input"
                  value={form.title}
                  maxLength={200}
                  disabled={!manage}
                  placeholder={form.type === "service" ? "For example: Coffee tasting session" : form.type === "digital" ? "For example: Home brewing guide (PDF)" : "For example: Masala Chai, 250 g"}
                  onChange={(e) => {
                    const title = e.target.value;
                    setForm((f) => (f ? { ...f, title, ...(handleTouched ? {} : { handle: handleize(title) }) } : f));
                  }}
                />
              </Field>
              <Field
                id={ids.desc}
                label="Description"
                hint={
                  <>
                    Shown on the product page. Line breaks are kept.
                    {productId && can("ai.use") && (
                      <>
                        {" "}
                        <a href={`${base}/ai?task=product_copy&target=${productId}`}>Write it with AI Studio</a>
                      </>
                    )}
                  </>
                }
              >
                <textarea id={ids.desc} className="c-textarea" rows={6} value={form.description} maxLength={20000} disabled={!manage} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card
            title="Photos and video"
            actions={
              manage && (
                <button type="button" className="c-btn c-btn-sm" onClick={() => setPicker("media")}>
                  <PlusIcon size={14} /> Add
                </button>
              )
            }
          >
            {form.mediaIds.length === 0 ? (
              <p className="c-hint" style={{ fontSize: 14 }}>
                The first image is the one shoppers see in lists. Add a few angles; square images look best.
              </p>
            ) : (
              <div className="c-media-strip">
                {form.mediaIds.map((id, i) => (
                  <div key={id} className="c-media-card">
                    {i === 0 && <Badge tone="brand">Main</Badge>}
                    <Thumb mediaId={id} size="lg" />
                    {manage && (
                      <div className="c-media-tools">
                        <button type="button" className="c-btn c-btn-ghost c-btn-icon c-btn-sm" aria-label="Move earlier" disabled={i === 0} onClick={() => set("mediaIds", swap(form.mediaIds, i, i - 1))}>
                          <ArrowLeftIcon size={14} />
                        </button>
                        <button type="button" className="c-btn c-btn-ghost c-btn-icon c-btn-sm" aria-label="Remove" onClick={() => set("mediaIds", form.mediaIds.filter((x) => x !== id))}>
                          <CloseIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="c-btn c-btn-ghost c-btn-icon c-btn-sm"
                          aria-label="Move later"
                          disabled={i === form.mediaIds.length - 1}
                          onClick={() => set("mediaIds", swap(form.mediaIds, i, i + 1))}
                        >
                          <ArrowRightIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Options">
            <label className="c-inline-check">
              <input
                type="checkbox"
                className="c-check-input"
                checked={form.hasOptions}
                disabled={!manage}
                onChange={(e) => applyOptions(e.target.checked && form.options.length === 0 ? [{ name: "Size", values: [] }] : form.options, e.target.checked)}
              />
              This product comes in options, like size or colour
            </label>
            {form.hasOptions && (
              <div className="c-form" style={{ marginTop: 14 }}>
                {form.options.map((o, i) => (
                  <div key={i} className="c-option-row">
                    <input
                      className="c-input"
                      value={o.name}
                      placeholder="Option name"
                      aria-label={`Option ${i + 1} name`}
                      maxLength={60}
                      disabled={!manage}
                      onChange={(e) => applyOptions(form.options.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <TagInput
                      value={o.values}
                      lowercase={false}
                      placeholder="Values: type and press Enter"
                      onChange={(values) => applyOptions(form.options.map((x, n) => (n === i ? { ...x, values } : x)))}
                    />
                    <button type="button" className="c-btn c-btn-ghost c-btn-icon" aria-label={`Remove option ${o.name || i + 1}`} disabled={!manage} onClick={() => applyOptions(form.options.filter((_, n) => n !== i))}>
                      <TrashIcon size={16} />
                    </button>
                  </div>
                ))}
                {form.options.length < 3 && manage && (
                  <button type="button" className="c-btn c-btn-sm" style={{ justifySelf: "start" }} onClick={() => applyOptions([...form.options, { name: "", values: [] }])}>
                    <PlusIcon size={14} /> Add another option
                  </button>
                )}
                {optionIssues.length > 0 && <p className="c-hint">{optionIssues[0]}</p>}
              </div>
            )}
          </Card>

          {form.hasOptions && form.options.some((o) => o.values.length > 0) ? (
            <Card title={`Variants (${form.variants.length})`}>
              <div className="c-table-wrap" style={{ boxShadow: "none" }}>
                <table className="c-table c-table-compact">
                  <caption className="c-visually-hidden">Variants</caption>
                  <thead>
                    <tr>
                      <th scope="col">Variant</th>
                      <th scope="col">Price</th>
                      <th scope="col">Compare at</th>
                      <th scope="col">SKU</th>
                      {form.type === "physical" && <th scope="col">Stock</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {form.variants.map((v) => (
                      <tr key={v.key}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{variantTitle(v.options)}</td>
                        <td>{moneyInput(v.price, (price) => setVariant(v.key, { price }), `Price for ${variantTitle(v.options)}`)}</td>
                        <td>{moneyInput(v.compareAt, (compareAt) => setVariant(v.key, { compareAt }), `Compare-at price for ${variantTitle(v.options)}`, "—")}</td>
                        <td>
                          <input className="c-input" value={v.sku} maxLength={64} disabled={!manage} aria-label={`SKU for ${variantTitle(v.options)}`} onChange={(e) => setVariant(v.key, { sku: e.target.value })} />
                        </td>
                        {form.type === "physical" && (
                          <td>
                            <input
                              className="c-input"
                              inputMode="numeric"
                              value={v.trackInventory ? v.stock : ""}
                              placeholder={v.trackInventory ? "0" : "—"}
                              disabled={!manage || !v.trackInventory}
                              aria-label={`Stock for ${variantTitle(v.options)}`}
                              onChange={(e) => setVariant(v.key, { stock: e.target.value })}
                              style={{ width: 90 }}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {manage && form.variants.length > 1 && (
                <button
                  type="button"
                  className="c-btn c-btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => set("variants", form.variants.map((v) => ({ ...v, price: form.variants[0]!.price, compareAt: form.variants[0]!.compareAt })))}
                >
                  Use the first price for all variants
                </button>
              )}
              {form.type === "physical" && (
                <label className="c-inline-check" style={{ marginTop: 12 }}>
                  <input
                    type="checkbox"
                    className="c-check-input"
                    checked={form.variants.every((v) => v.trackInventory)}
                    disabled={!manage}
                    onChange={(e) => set("variants", form.variants.map((v) => ({ ...v, trackInventory: e.target.checked })))}
                  />
                  Track stock for these variants
                </label>
              )}
            </Card>
          ) : (
            <Card title="Pricing">
              <div className="c-form-row">
                <Field id={`${ids.title}-price`} label="Price">
                  {moneyInput(single.price, (price) => setVariant(single.key, { price }), "Price")}
                </Field>
                <Field id={`${ids.title}-cmp`} label={<>Compare-at price <small>(optional)</small></>} hint="Shown struck through, for a sale.">
                  {moneyInput(single.compareAt, (compareAt) => setVariant(single.key, { compareAt }), "Compare-at price", "—")}
                </Field>
                <Field id={`${ids.title}-cost`} label={<>Cost per item <small>(private)</small></>} hint="For your margins; shoppers never see it.">
                  {moneyInput(single.cost, (cost) => setVariant(single.key, { cost }), "Cost per item", "—")}
                </Field>
              </div>
            </Card>
          )}

          {form.type === "physical" && !(form.hasOptions && form.options.some((o) => o.values.length > 0)) && (
            <Card title="Inventory and shipping">
              <div className="c-form">
                <div className="c-form-row">
                  <Field id={`${ids.title}-sku`} label={<>SKU <small>(optional)</small></>}>
                    <input id={`${ids.title}-sku`} className="c-input" value={single.sku} maxLength={64} disabled={!manage} onChange={(e) => setVariant(single.key, { sku: e.target.value })} />
                  </Field>
                  <Field id={`${ids.title}-bar`} label={<>Barcode <small>(optional)</small></>}>
                    <input id={`${ids.title}-bar`} className="c-input" value={single.barcode} maxLength={64} disabled={!manage} onChange={(e) => setVariant(single.key, { barcode: e.target.value })} />
                  </Field>
                  <Field id={`${ids.title}-wt`} label={<>Weight <small>(grams)</small></>} hint="Used for weight-based shipping rates.">
                    <input id={`${ids.title}-wt`} className="c-input" inputMode="numeric" value={single.weight} disabled={!manage} onChange={(e) => setVariant(single.key, { weight: e.target.value })} />
                  </Field>
                </div>
                <label className="c-inline-check">
                  <input type="checkbox" className="c-check-input" checked={single.trackInventory} disabled={!manage} onChange={(e) => setVariant(single.key, { trackInventory: e.target.checked })} />
                  Track stock
                </label>
                {single.trackInventory && (
                  <div className="c-form-row">
                    <Field id={`${ids.title}-stock`} label="In stock" hint={productId ? "Changes here are recorded in the stock history as corrections." : undefined}>
                      <input id={`${ids.title}-stock`} className="c-input" inputMode="numeric" value={single.stock} disabled={!manage} onChange={(e) => setVariant(single.key, { stock: e.target.value })} />
                    </Field>
                    <div className="c-field" style={{ alignSelf: "end" }}>
                      <label className="c-inline-check">
                        <input type="checkbox" className="c-check-input" checked={single.allowBackorder} disabled={!manage} onChange={(e) => setVariant(single.key, { allowBackorder: e.target.checked })} />
                        Keep selling when out of stock
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {form.type === "digital" && (
            <Card
              title="Files buyers download"
              actions={
                manage && (
                  <button type="button" className="c-btn c-btn-sm" onClick={() => setPicker("file")}>
                    <PlusIcon size={14} /> Add files
                  </button>
                )
              }
            >
              {form.fileIds.length === 0 ? (
                <p className="c-hint" style={{ fontSize: 14 }}>
                  Buyers get a private download link after paying. Files are scanned for malware and never public.
                </p>
              ) : (
                <ul className="c-checklist">
                  {form.fileIds.map((id) => {
                    const f = knownMedia[id];
                    return (
                      <li key={id}>
                        <span className="c-thumb c-thumb-sm" aria-hidden="true">
                          <FileIcon size={16} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <strong>{f?.filename ?? "File"}</strong>
                          <span>{f ? `${(f.byteSize / 1024 / 1024).toFixed(1)} MB` : ""}</span>
                        </div>
                        {manage && (
                          <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => set("fileIds", form.fileIds.filter((x) => x !== id))}>
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="c-form-row" style={{ marginTop: 12 }}>
                <Field id={`${ids.title}-dl`} label={<>Downloads per purchase <small>(optional)</small></>} hint="Blank for unlimited.">
                  <input id={`${ids.title}-dl`} className="c-input" inputMode="numeric" value={form.downloadLimit} disabled={!manage} onChange={(e) => set("downloadLimit", e.target.value)} />
                </Field>
                <Field id={`${ids.title}-exp`} label={<>Link works for <small>(days, optional)</small></>} hint="Blank to never expire.">
                  <input id={`${ids.title}-exp`} className="c-input" inputMode="numeric" value={form.downloadExpiryDays} disabled={!manage} onChange={(e) => set("downloadExpiryDays", e.target.value)} />
                </Field>
              </div>
            </Card>
          )}

          {form.type === "service" && (
            <Card title="Booking">
              <div className="c-form-row">
                <Field id={`${ids.title}-dur`} label="Length (minutes)">
                  <input id={`${ids.title}-dur`} className="c-input" inputMode="numeric" value={form.bookingDuration} disabled={!manage} onChange={(e) => set("bookingDuration", e.target.value)} />
                </Field>
                <Field id={`${ids.title}-not`} label="Minimum notice (hours)" hint="How far ahead shoppers must book.">
                  <input id={`${ids.title}-not`} className="c-input" inputMode="numeric" value={form.bookingNotice} disabled={!manage} onChange={(e) => set("bookingNotice", e.target.value)} />
                </Field>
                <Field id={`${ids.title}-cap`} label="Bookings per time slot">
                  <input id={`${ids.title}-cap`} className="c-input" inputMode="numeric" value={form.bookingCapacity} disabled={!manage} onChange={(e) => set("bookingCapacity", e.target.value)} />
                </Field>
              </div>
              <h3 style={{ fontSize: 14.5, margin: "16px 0 8px" }}>Hours you take bookings</h3>
              <HoursEditor idPrefix={`${ids.title}-hours`} value={form.bookingHours} disabled={!manage} onChange={(h) => set("bookingHours", h)} />
              <p className="c-hint" style={{ marginTop: 10 }}>
                Shoppers pick from slots of the length above, in your store&apos;s time zone ({store.timezone}). See upcoming bookings under Orders → Bookings.
              </p>
            </Card>
          )}

          <Card title="Tax">
            <Field id={`${ids.title}-tax`} label={<>Tax rate (%) <small>(optional)</small></>} hint="Blank uses your store's usual rate, set in Payments & Finances. Use 0 for exempt items.">
              <input id={`${ids.title}-tax`} className="c-input" inputMode="decimal" style={{ maxWidth: 160 }} value={form.taxRate} disabled={!manage} onChange={(e) => set("taxRate", e.target.value)} placeholder="Store rate" />
            </Field>
          </Card>

          <Card title="Search engine listing">
            <div className="c-form">
              <Field id={ids.handle} label="URL handle" hint={`${storefrontUrl(store.slug).replace(/^https?:\/\//, "")}/p/${form.handle || "…"}`}>
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
              </Field>
              <Field id={ids.seoT} label={<>Page title <small>({form.seoTitle.length}/70 recommended)</small></>}>
                <input id={ids.seoT} className="c-input" value={form.seoTitle} maxLength={120} placeholder={form.title} disabled={!manage} onChange={(e) => set("seoTitle", e.target.value)} />
              </Field>
              <Field id={ids.seoD} label={<>Meta description <small>({form.seoDescription.length}/160 recommended)</small></>}>
                <textarea id={ids.seoD} className="c-textarea" rows={3} value={form.seoDescription} maxLength={320} disabled={!manage} onChange={(e) => set("seoDescription", e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="c-detail-side">
          <Card title="Status">
            <div className="c-form">
              <select id={ids.status} className="c-select" value={form.status} disabled={!manage} onChange={(e) => set("status", e.target.value as ProductStatus)} aria-label="Status">
                <option value="active">Active: on sale in your store</option>
                <option value="draft">Draft: hidden from shoppers</option>
                <option value="archived">Archived: kept, but hidden everywhere</option>
              </select>
              {productId && (
                <>
                  <label className="c-label" htmlFor={ids.type}>
                    Product type
                  </label>
                  <select id={ids.type} className="c-select" value={form.type} disabled={!manage} onChange={(e) => set("type", e.target.value as ProductType)}>
                    {(Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]).map((t) => (
                      <option key={t} value={t}>
                        {PRODUCT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </Card>
          <Card title="Organization">
            <div className="c-form">
              <Field id={ids.vendor} label={<>Brand or vendor <small>(optional)</small></>}>
                <input id={ids.vendor} className="c-input" value={form.vendor} maxLength={100} disabled={!manage} onChange={(e) => set("vendor", e.target.value)} />
              </Field>
              <Field id={ids.tags} label="Tags" hint="Used for search and automated collections.">
                <TagInput id={ids.tags} value={form.tags} onChange={(tags) => set("tags", tags)} />
              </Field>
              <div className="c-field">
                <span className="c-label">Collections</span>
                {collections.length === 0 ? (
                  <p className="c-hint">
                    No hand-picked collections yet. <a href={`${base}/collections/new`}>Create one</a>.
                  </p>
                ) : (
                  collections.map((c) => (
                    <label key={c.id} className="c-inline-check">
                      <input
                        type="checkbox"
                        className="c-check-input"
                        checked={form.collectionIds.includes(c.id)}
                        disabled={!manage}
                        onChange={() => set("collectionIds", form.collectionIds.includes(c.id) ? form.collectionIds.filter((x) => x !== c.id) : [...form.collectionIds, c.id])}
                      />
                      {c.title}
                    </label>
                  ))
                )}
                <p className="c-hint">Automated collections pick products by their rules.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {manage && (
        <div className="c-savebar">
          <div className="c-status" role={problems.length ? "alert" : "status"}>
            {problems.length > 0 ? (
              <span className="c-error">
                {problems[0]}
                {problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}
              </span>
            ) : status ? (
              <span className="c-ok">{status}</span>
            ) : dirty ? (
              <span className="c-muted">Unsaved changes</span>
            ) : null}
          </div>
          {productId && dirty && (
            <button type="button" className="c-btn" onClick={() => saved && setForm(JSON.parse(saved) as Form)}>
              Discard
            </button>
          )}
          <button type="button" className="c-btn c-btn-primary" disabled={busy || (!dirty && Boolean(productId))} onClick={() => void save()}>
            {busy ? "Saving…" : productId ? "Save" : "Save product"}
          </button>
        </div>
      )}

      {picker && (
        <MediaPicker
          storeId={store.id}
          open
          kind={picker}
          title={picker === "file" ? "Choose files to deliver" : "Choose photos and video"}
          initial={picker === "file" ? form.fileIds : form.mediaIds}
          onClose={() => setPicker(undefined)}
          onPick={(picked, assets) => {
            setKnownMedia((k) => ({ ...k, ...Object.fromEntries(assets.map((a) => [a.id, a])) }));
            set(picker === "file" ? "fileIds" : "mediaIds", picked);
          }}
        />
      )}
    </Page>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
