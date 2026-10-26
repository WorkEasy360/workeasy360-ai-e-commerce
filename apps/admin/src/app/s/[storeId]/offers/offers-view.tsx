"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatMoney, parseMoney, toDecimalString } from "@workeasy/commerce";
import { Badge, EmptyState, OfferIcon, Page, PageHeader, PlusIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { ProductPicker } from "../../../../components/product-picker";
import { api, ApiError, errorMessage } from "../../../../lib/api";
import type { ProductList, ProductSummary } from "../../../../lib/catalog";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

type DiscountType = "percentage" | "fixed" | "free_shipping" | "buy_x_get_y";
type Scope = "all" | "collections" | "products";
type GetScope = "same" | "collections" | "products";

interface BuyXGetY {
  buyQuantity: number;
  getQuantity: number;
  getAppliesTo: GetScope;
  getTargetIds: string[];
  maxApplications: number | null;
}
type Status = "active" | "scheduled" | "expired" | "used_up" | "disabled";

interface Discount {
  id: string;
  method: "code" | "automatic";
  code: string | null;
  title: string;
  type: DiscountType;
  value: number;
  minSubtotalMinor: number | null;
  appliesTo: Scope;
  targetIds: string[];
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  buyXGetY: BuyXGetY | null;
  usageCount: number;
  enabled: boolean;
  status: Status;
  redeemedMinor: number;
}

const STATUS: Record<Status, { label: string; tone: "success" | "info" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
  used_up: { label: "Used up", tone: "warning" },
  disabled: { label: "Turned off", tone: "neutral" },
};

/** "2026-10-23T14:30" for a datetime-local input, in the browser's time. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Form {
  method: "code" | "automatic";
  code: string;
  title: string;
  type: DiscountType;
  amount: string;
  minSubtotal: string;
  appliesTo: Scope;
  products: ProductSummary[];
  collectionIds: string[];
  buyQuantity: string;
  getQuantity: string;
  getAppliesTo: GetScope;
  getProducts: ProductSummary[];
  getCollectionIds: string[];
  /** Buy X get Y: what they get is free, rather than a percentage off. */
  getFree: boolean;
  maxApplications: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  oncePerCustomer: boolean;
  enabled: boolean;
}

function formOf(d: Discount | undefined, currency: string): Form {
  const offer = d?.buyXGetY ?? null;
  const getFree = !offer || d?.value === 10_000;
  return {
    method: d?.method ?? "code",
    code: d?.code ?? "",
    title: d?.title ?? "",
    type: d?.type ?? "percentage",
    amount:
      !d || d.type === "free_shipping" || (d.type === "buy_x_get_y" && getFree) ? "" : d.type === "percentage" || d.type === "buy_x_get_y" ? String(d.value / 100) : toDecimalString(d.value, currency),
    minSubtotal: d?.minSubtotalMinor != null ? toDecimalString(d.minSubtotalMinor, currency) : "",
    appliesTo: d?.appliesTo ?? "all",
    products: [],
    collectionIds: d?.appliesTo === "collections" ? d.targetIds : [],
    buyQuantity: String(offer?.buyQuantity ?? 2),
    getQuantity: String(offer?.getQuantity ?? 1),
    getAppliesTo: offer?.getAppliesTo ?? "same",
    getProducts: [],
    getCollectionIds: offer?.getAppliesTo === "collections" ? offer.getTargetIds : [],
    getFree,
    maxApplications: offer?.maxApplications ? String(offer.maxApplications) : "",
    startsAt: localInput(d?.startsAt ?? null),
    endsAt: localInput(d?.endsAt ?? null),
    usageLimit: d?.usageLimit ? String(d.usageLimit) : "",
    oncePerCustomer: d?.oncePerCustomer ?? false,
    enabled: d?.enabled ?? true,
  };
}

/** Describes an offer in a few words: "10% off", "₹100 off orders over ₹999", "Buy 2, get 1 free". */
function summary(d: Pick<Discount, "type" | "value" | "minSubtotalMinor" | "appliesTo" | "buyXGetY">, money: (m: number) => string): string {
  const over = d.minSubtotalMinor ? ` on orders over ${money(d.minSubtotalMinor)}` : "";
  if (d.type === "buy_x_get_y" && d.buyXGetY) {
    const o = d.buyXGetY;
    const from = d.appliesTo === "all" ? "" : d.appliesTo === "products" ? " of selected products" : " from selected collections";
    const gets = o.getAppliesTo === "same" ? "" : o.getAppliesTo === "products" ? " of selected products" : " from selected collections";
    const deal = d.value >= 10_000 ? "free" : `at ${d.value / 100}% off`;
    return `Buy ${o.buyQuantity}${from}, get ${o.getQuantity}${gets} ${deal}${o.maxApplications ? ` (up to ${o.maxApplications}× per order)` : ""}${over}`;
  }
  const what = d.type === "percentage" ? `${d.value / 100}% off` : d.type === "fixed" ? `${money(d.value)} off` : "Free shipping";
  const scope = d.appliesTo === "all" ? "" : d.appliesTo === "products" ? " selected products" : " selected collections";
  return `${what}${scope}${over}`;
}

/** Products or collections an offer covers: a scope select, then the products picked or collections ticked. */
function ScopeField<S extends string>(props: {
  id: string;
  label: string;
  options: ReadonlyArray<readonly [S, string]>;
  scope: S;
  onScope: (s: S) => void;
  products: ProductSummary[];
  onProducts: (p: ProductSummary[]) => void;
  collectionIds: string[];
  onCollections: (ids: string[]) => void;
  collections: Array<{ id: string; title: string }> | undefined;
  storeId: string;
  currency: string;
  error: React.ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={props.id}>
        {props.label}
      </label>
      <select id={props.id} className="c-select" value={props.scope} onChange={(e) => props.onScope(e.target.value as S)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {props.scope === "products" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="c-btn c-btn-sm" onClick={() => setPicking(true)}>
            Choose products
          </button>
          <span className="c-muted">{props.products.length === 0 ? "None chosen" : props.products.map((p) => p.title).join(", ")}</span>
        </div>
      )}
      {props.scope === "collections" && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {props.collections === undefined ? (
            <div className="c-skeleton" style={{ height: 24 }} />
          ) : props.collections.length === 0 ? (
            <span className="c-muted">No collections yet.</span>
          ) : (
            props.collections.map((c) => (
              <label key={c.id} className="c-inline-check">
                <input
                  type="checkbox"
                  className="c-check-input"
                  checked={props.collectionIds.includes(c.id)}
                  onChange={(e) => props.onCollections(e.target.checked ? [...props.collectionIds, c.id] : props.collectionIds.filter((x) => x !== c.id))}
                />
                {c.title}
              </label>
            ))
          )}
        </div>
      )}
      {props.error}
      {picking && <ProductPicker storeId={props.storeId} currency={props.currency} initial={props.products} onClose={() => setPicking(false)} onPick={props.onProducts} />}
    </div>
  );
}

const SCOPES = [
  ["all", "Every product"],
  ["collections", "Products in collections"],
  ["products", "Specific products"],
] as const;
const BUY_SCOPES = [
  ["all", "Any product"],
  ["collections", "Products in collections"],
  ["products", "Specific products"],
] as const;
const GET_SCOPES = [
  ["same", "The same products"],
  ["collections", "Products in collections"],
  ["products", "Specific products"],
] as const;

function OfferDialog({ storeId, currency, locale, discount, onDone, onClose }: { storeId: string; currency: string; locale: string; discount: Discount | undefined; onDone: () => void; onClose: () => void }) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => formOf(discount, currency));
  const [collections, setCollections] = useState<Array<{ id: string; title: string }> | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const money = (m: number) => formatMoney(m, currency, locale, { compact: true });

  useEffect(() => {
    api<{ items: Array<{ id: string; title: string }> }>(`/api/v1/stores/${storeId}/collections`)
      .then((r) => setCollections(r.items))
      .catch(() => setCollections([]));
    const getIds = discount?.buyXGetY?.getAppliesTo === "products" ? discount.buyXGetY.getTargetIds : [];
    if (discount?.appliesTo === "products" || getIds.length > 0) {
      api<ProductList>(`/api/v1/stores/${storeId}/products?limit=100`)
        .then((r) =>
          setForm((f) => ({
            ...f,
            products: discount?.appliesTo === "products" ? r.items.filter((p) => discount.targetIds.includes(p.id)) : f.products,
            getProducts: r.items.filter((p) => getIds.includes(p.id)),
          })),
        )
        .catch(() => undefined);
    }
  }, [storeId, discount]);

  async function save() {
    const bxgy = form.type === "buy_x_get_y";
    const value = bxgy && form.getFree ? 10_000 : form.type === "percentage" || bxgy ? Math.round(Number(form.amount) * 100) : form.type === "fixed" ? parseMoney(form.amount, currency) : 0;
    const min = form.minSubtotal.trim() ? parseMoney(form.minSubtotal, currency) : null;
    const local: Record<string, string> = {};
    if (form.type !== "free_shipping" && (!value || Number.isNaN(value))) local.value = form.type === "fixed" ? "Enter the amount off" : "Enter a percentage, such as 10";
    if (bxgy && !(Number(form.buyQuantity) >= 1)) local["buyXGetY.buyQuantity"] = "Enter how many they buy";
    if (bxgy && !(Number(form.getQuantity) >= 1)) local["buyXGetY.getQuantity"] = "Enter how many they get";
    if (min === undefined) local.minSubtotalMinor = "Enter an amount, such as 999";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      await api(`/api/v1/stores/${storeId}/discounts${discount ? `/${discount.id}` : ""}`, {
        method: discount ? "PUT" : "POST",
        body: {
          method: form.method,
          code: form.method === "code" ? form.code : null,
          title: form.title || (form.method === "code" ? form.code.toUpperCase() : ""),
          type: form.type,
          value: value ?? 0,
          minSubtotalMinor: min,
          appliesTo: form.appliesTo,
          targetIds: form.appliesTo === "products" ? form.products.map((p) => p.id) : form.appliesTo === "collections" ? form.collectionIds : [],
          ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
          oncePerCustomer: form.oncePerCustomer,
          enabled: form.enabled,
          buyXGetY: bxgy
            ? {
                buyQuantity: Number(form.buyQuantity),
                getQuantity: Number(form.getQuantity),
                getAppliesTo: form.getAppliesTo,
                getTargetIds: form.getAppliesTo === "products" ? form.getProducts.map((p) => p.id) : form.getAppliesTo === "collections" ? form.getCollectionIds : [],
                maxApplications: form.maxApplications ? Number(form.maxApplications) : null,
              }
            : null,
        },
      });
      onDone();
    } catch (err) {
      setErrors(err instanceof ApiError && err.problem.errors ? Object.fromEntries(err.problem.errors.map((e) => [e.field, e.message])) : {});
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const fieldError = (name: string) => errors[name] && <p className="c-error">{errors[name]}</p>;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={discount ? `Edit ${discount.code ?? discount.title}` : "Create offer"}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : discount ? "Save" : "Create offer"}
          </button>
        </>
      }
    >
      <div className="c-radio-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="c-radio-card">
          <input type="radio" className="c-check-input" name={`${id}-m`} checked={form.method === "code"} onChange={() => set("method", "code")} />
          <span>
            <strong>Discount code</strong>
            <span>Shoppers type it at checkout.</span>
          </span>
        </label>
        <label className="c-radio-card">
          <input type="radio" className="c-check-input" name={`${id}-m`} checked={form.method === "automatic"} onChange={() => set("method", "automatic")} />
          <span>
            <strong>Automatic</strong>
            <span>Applied to every cart that qualifies.</span>
          </span>
        </label>
      </div>
      <div className="c-form-row" style={{ marginTop: 12 }}>
        {form.method === "code" && (
          <div className="c-field">
            <label className="c-label" htmlFor={`${id}-code`}>
              Code
            </label>
            <input id={`${id}-code`} className="c-input" style={{ textTransform: "uppercase" }} value={form.code} maxLength={32} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="DIWALI10" />
            {fieldError("code")}
          </div>
        )}
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-title`}>
            {form.method === "code" ? "Name" : "Name shoppers see"} {form.method === "code" && <small>(optional)</small>}
          </label>
          <input id={`${id}-title`} className="c-input" value={form.title} maxLength={100} onChange={(e) => set("title", e.target.value)} placeholder={form.method === "code" ? "Diwali sale" : "Free shipping over ₹999"} />
          {fieldError("title")}
        </div>
      </div>
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-type`}>
            Discount
          </label>
          <select id={`${id}-type`} className="c-select" value={form.type} onChange={(e) => set("type", e.target.value as DiscountType)}>
            <option value="percentage">Percentage off</option>
            <option value="fixed">Amount off</option>
            <option value="free_shipping">Free shipping</option>
            <option value="buy_x_get_y">Buy X, get Y</option>
          </select>
        </div>
        {(form.type === "percentage" || form.type === "fixed") && (
          <div className="c-field">
            <label className="c-label" htmlFor={`${id}-value`}>
              {form.type === "percentage" ? "Percentage" : `Amount (${currency})`}
            </label>
            <input id={`${id}-value`} className="c-input" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder={form.type === "percentage" ? "10" : "100"} />
            {fieldError("value")}
          </div>
        )}
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-min`}>
            Minimum order <small>(optional)</small>
          </label>
          <input id={`${id}-min`} className="c-input" inputMode="decimal" value={form.minSubtotal} onChange={(e) => set("minSubtotal", e.target.value)} placeholder="999" />
          {fieldError("minSubtotalMinor")}
        </div>
      </div>
      {(form.type === "percentage" || form.type === "fixed") && (
        <ScopeField
          id={`${id}-scope`}
          label="Applies to"
          options={SCOPES}
          scope={form.appliesTo}
          onScope={(v) => set("appliesTo", v)}
          products={form.products}
          onProducts={(v) => set("products", v)}
          collectionIds={form.collectionIds}
          onCollections={(v) => set("collectionIds", v)}
          collections={collections}
          storeId={storeId}
          currency={currency}
          error={fieldError("targetIds")}
        />
      )}
      {form.type === "buy_x_get_y" && (
        <>
          <fieldset className="c-fieldset">
            <legend>Customer buys</legend>
            <div className="c-form-row">
              <div className="c-field">
                <label className="c-label" htmlFor={`${id}-buy`}>
                  Quantity
                </label>
                <input id={`${id}-buy`} className="c-input" type="number" min={1} max={100} value={form.buyQuantity} onChange={(e) => set("buyQuantity", e.target.value)} />
                {fieldError("buyXGetY.buyQuantity")}
              </div>
              <ScopeField
                id={`${id}-buyfrom`}
                label="From"
                options={BUY_SCOPES}
                scope={form.appliesTo}
                onScope={(v) => set("appliesTo", v)}
                products={form.products}
                onProducts={(v) => set("products", v)}
                collectionIds={form.collectionIds}
                onCollections={(v) => set("collectionIds", v)}
                collections={collections}
                storeId={storeId}
                currency={currency}
                error={fieldError("targetIds")}
              />
            </div>
          </fieldset>
          <fieldset className="c-fieldset">
            <legend>Customer gets</legend>
            <div className="c-form-row">
              <div className="c-field">
                <label className="c-label" htmlFor={`${id}-get`}>
                  Quantity
                </label>
                <input id={`${id}-get`} className="c-input" type="number" min={1} max={100} value={form.getQuantity} onChange={(e) => set("getQuantity", e.target.value)} />
                {fieldError("buyXGetY.getQuantity")}
              </div>
              <ScopeField
                id={`${id}-getfrom`}
                label="From"
                options={GET_SCOPES}
                scope={form.getAppliesTo}
                onScope={(v) => set("getAppliesTo", v)}
                products={form.getProducts}
                onProducts={(v) => set("getProducts", v)}
                collectionIds={form.getCollectionIds}
                onCollections={(v) => set("getCollectionIds", v)}
                collections={collections}
                storeId={storeId}
                currency={currency}
                error={fieldError("buyXGetY.getTargetIds")}
              />
            </div>
            <div className="c-form-row">
              <div className="c-field">
                <span className="c-label" id={`${id}-at`}>
                  At
                </span>
                <div className="c-segmented" role="group" aria-labelledby={`${id}-at`}>
                  <button type="button" aria-pressed={form.getFree} onClick={() => set("getFree", true)}>
                    Free
                  </button>
                  <button type="button" aria-pressed={!form.getFree} onClick={() => set("getFree", false)}>
                    Percentage off
                  </button>
                </div>
              </div>
              {!form.getFree && (
                <div className="c-field">
                  <label className="c-label" htmlFor={`${id}-pct`}>
                    Percentage off
                  </label>
                  <input id={`${id}-pct`} className="c-input" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="50" />
                  {fieldError("value")}
                </div>
              )}
              <div className="c-field">
                <label className="c-label" htmlFor={`${id}-max`}>
                  Times per order <small>(optional)</small>
                </label>
                <input id={`${id}-max`} className="c-input" type="number" min={1} max={100} value={form.maxApplications} onChange={(e) => set("maxApplications", e.target.value)} placeholder="No limit" />
              </div>
            </div>
            <p className="c-hint" style={{ margin: 0 }}>
              The cheapest qualifying items are the ones discounted.
            </p>
          </fieldset>
        </>
      )}
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-start`}>
            Starts <small>(optional)</small>
          </label>
          <input id={`${id}-start`} className="c-input" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-end`}>
            Ends <small>(optional)</small>
          </label>
          <input id={`${id}-end`} className="c-input" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          {fieldError("endsAt")}
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-limit`}>
            Total uses <small>(optional)</small>
          </label>
          <input id={`${id}-limit`} className="c-input" type="number" min={1} value={form.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} placeholder="Unlimited" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {form.method === "code" && (
          <label className="c-inline-check">
            <input type="checkbox" className="c-check-input" checked={form.oncePerCustomer} onChange={(e) => set("oncePerCustomer", e.target.checked)} />
            Once per customer
          </label>
        )}
        <label className="c-inline-check">
          <input type="checkbox" className="c-check-input" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Turned on
        </label>
      </div>
      <p className="c-hint" style={{ marginBottom: 0 }}>
        Preview:{" "}
        {summary(
          {
            type: form.type,
            value: form.type === "buy_x_get_y" && form.getFree ? 10_000 : form.type === "percentage" || form.type === "buy_x_get_y" ? Math.round(Number(form.amount || 0) * 100) : (parseMoney(form.amount, currency) ?? 0),
            minSubtotalMinor: parseMoney(form.minSubtotal, currency) ?? null,
            appliesTo: form.type === "free_shipping" ? "all" : form.appliesTo,
            buyXGetY: { buyQuantity: Number(form.buyQuantity) || 0, getQuantity: Number(form.getQuantity) || 0, getAppliesTo: form.getAppliesTo, getTargetIds: [], maxApplications: Number(form.maxApplications) || null },
          },
          money,
        )}
        . One offer per order: a code replaces any automatic offer.
      </p>
      {error && Object.keys(errors).length === 0 && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Offers: discount codes and automatic deals, with how often each has been used. */
export function OffersView() {
  const ctx = useStore();
  const mod = moduleByKey("offers");
  const [items, setItems] = useState<Discount[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Discount | "new" | undefined>();
  const [removing, setRemoving] = useState<Discount | undefined>();
  const storeId = ctx?.store.id;

  const refresh = useCallback(() => {
    if (!storeId) return;
    api<{ items: Discount[] }>(`/api/v1/stores/${storeId}/discounts`)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!ctx) return null;
  const { store, can } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number) => formatMoney(m, store.currency, locale, { compact: true });
  const manage = can("offers.manage");
  const create = manage && (
    <button type="button" className="c-btn c-btn-primary" onClick={() => setEditing("new")}>
      <PlusIcon size={16} /> Create offer
    </button>
  );

  async function remove(d: Discount) {
    try {
      await api(`/api/v1/stores/${store.id}/discounts/${d.id}`, { method: "DELETE" });
      setRemoving(undefined);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} actions={items && items.length > 0 ? create : undefined} />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {items && items.length === 0 ? (
        <EmptyState icon={<OfferIcon size={26} />} title="No offers yet" actions={create}>
          Create a code to share on WhatsApp and Instagram, or an automatic deal such as free shipping over ₹999.
        </EmptyState>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table c-table-stack">
            <caption className="c-visually-hidden">Offers</caption>
            <thead>
              <tr>
                <th scope="col">Offer</th>
                <th scope="col">Status</th>
                <th scope="col">Runs</th>
                <th scope="col" className="c-num">
                  Used
                </th>
                <th scope="col" className="c-num">
                  Given away
                </th>
                <th scope="col">
                  <span className="c-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items === undefined ? (
                <tr>
                  <td colSpan={6}>
                    <div className="c-skeleton" role="status" aria-label="Loading offers" />
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Offer">
                      <span className="c-cell-title">{d.code ? <code className="c-code">{d.code}</code> : d.title}</span>
                      <span className="c-cell-sub">
                        {d.method === "automatic" ? "Automatic · " : d.title !== d.code ? `${d.title} · ` : ""}
                        {summary(d, money)}
                      </span>
                    </td>
                    <td data-label="Status">
                      <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    </td>
                    <td data-label="Runs">
                      {new Date(d.startsAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                      {d.endsAt ? ` – ${new Date(d.endsAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : " onwards"}
                    </td>
                    <td data-label="Used" className="c-num">
                      {d.usageCount}
                      {d.usageLimit ? ` / ${d.usageLimit}` : ""}
                    </td>
                    <td data-label="Given away" className="c-num">
                      {money(d.redeemedMinor)}
                    </td>
                    <td data-label="Actions" className="c-num">
                      {manage && (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" className="c-btn c-btn-sm" onClick={() => setEditing(d)}>
                            Edit
                          </button>
                          <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => setRemoving(d)}>
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <OfferDialog
          storeId={store.id}
          currency={store.currency}
          locale={locale}
          discount={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(undefined)}
          title={`Delete ${removing.code ?? removing.title}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setRemoving(undefined)}>
                Keep it
              </button>
              <button type="button" className="c-btn c-btn-danger" onClick={() => void remove(removing)}>
                Delete
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Shoppers can no longer use it. Orders that already used it keep their discount. To pause an offer instead, edit it and turn it off.</p>
        </Dialog>
      )}
    </Page>
  );
}
