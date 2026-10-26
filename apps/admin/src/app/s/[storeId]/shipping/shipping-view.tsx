"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatMoney, parseMoney, toDecimalString } from "@workeasy/commerce";
import { ArrowDownIcon, ArrowUpIcon, Badge, Card, EmptyState, Page, PageHeader, PlusIcon, ShippingIcon, TrashIcon } from "@workeasy/ui/react";
import { Dialog, TagInput } from "@workeasy/ui/client";
import { api, ApiError, errorMessage } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import type { CheckoutSettings } from "../../../../lib/orders";
import { useStore } from "../store-shell";

type RateKind = "flat" | "weight" | "price";

interface Rate {
  id: string;
  name: string;
  kind: RateKind;
  minValue: number | null;
  maxValue: number | null;
  priceMinor: number;
  freeOverMinor: number | null;
  deliveryTime: string | null;
}

interface Zone {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  postalPrefixes: string[];
  codEnabled: boolean;
  rates: Rate[];
}

interface RateForm {
  name: string;
  kind: RateKind;
  min: string;
  max: string;
  price: string;
  freeOver: string;
  deliveryTime: string;
}

const KIND_LABEL: Record<RateKind, string> = { flat: "Always", weight: "By weight", price: "By order value" };

function rangeText(r: Rate, money: (m: number) => string): string {
  if (r.kind === "flat") return "Every order";
  const unit = (v: number) => (r.kind === "weight" ? (v >= 1000 ? `${v / 1000} kg` : `${v} g`) : money(v));
  if (r.minValue !== null && r.maxValue !== null) return `${unit(r.minValue)} – ${unit(r.maxValue)}`;
  if (r.minValue !== null) return `${unit(r.minValue)} and up`;
  if (r.maxValue !== null) return `Up to ${unit(r.maxValue)}`;
  return "Every order";
}

function ZoneDialog({ storeId, currency, country, zone, onDone, onClose }: { storeId: string; currency: string; country: string; zone: Zone | undefined; onDone: (zones: Zone[]) => void; onClose: () => void }) {
  const id = useId();
  const toForm = (r: Rate): RateForm => ({
    name: r.name,
    kind: r.kind,
    min: r.minValue === null ? "" : r.kind === "price" ? toDecimalString(r.minValue, currency) : String(r.minValue),
    max: r.maxValue === null ? "" : r.kind === "price" ? toDecimalString(r.maxValue, currency) : String(r.maxValue),
    price: toDecimalString(r.priceMinor, currency),
    freeOver: r.freeOverMinor === null ? "" : toDecimalString(r.freeOverMinor, currency),
    deliveryTime: r.deliveryTime ?? "",
  });
  const [name, setName] = useState(zone?.name ?? "");
  const [countries, setCountries] = useState<string[]>(zone?.countries ?? [country]);
  const [regions, setRegions] = useState<string[]>(zone?.regions ?? []);
  const [prefixes, setPrefixes] = useState<string[]>(zone?.postalPrefixes ?? []);
  const [cod, setCod] = useState(zone?.codEnabled ?? true);
  const [rates, setRates] = useState<RateForm[]>(zone ? zone.rates.map(toForm) : [{ name: "Standard delivery", kind: "flat", min: "", max: "", price: "", freeOver: "", deliveryTime: "3–5 days" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const setRate = (i: number, patch: Partial<RateForm>) => setRates((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const value = (kind: RateKind, v: string) => (v.trim() === "" ? null : kind === "price" ? (parseMoney(v, currency) ?? Number.NaN) : Math.round(Number(v)));

  async function save() {
    const body = {
      name,
      countries,
      regions,
      postalPrefixes: prefixes,
      codEnabled: cod,
      rates: rates.map((r) => ({
        name: r.name,
        kind: r.kind,
        minValue: r.kind === "flat" ? null : value(r.kind, r.min),
        maxValue: r.kind === "flat" ? null : value(r.kind, r.max),
        priceMinor: parseMoney(r.price || "0", currency) ?? Number.NaN,
        freeOverMinor: r.freeOver.trim() ? (parseMoney(r.freeOver, currency) ?? Number.NaN) : null,
        deliveryTime: r.deliveryTime || null,
      })),
    };
    if (body.rates.some((r) => [r.minValue, r.maxValue, r.priceMinor, r.freeOverMinor].some((v) => Number.isNaN(v)))) {
      setError("Check the amounts: use numbers such as 49 or 499.50");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ zones: Zone[] }>(`/api/v1/stores/${storeId}/shipping/zones${zone ? `/${zone.id}` : ""}`, { method: zone ? "PUT" : "POST", body });
      onDone(r.zones);
    } catch (err) {
      setError(err instanceof ApiError && err.problem.errors?.[0] ? `${err.problem.errors[0].message}` : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={zone ? `Edit ${zone.name}` : "Add shipping zone"}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !name.trim() || countries.length === 0 || rates.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : zone ? "Save zone" : "Add zone"}
          </button>
        </>
      }
    >
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-name`}>
            Zone name
          </label>
          <input id={`${id}-name`} className="c-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Bengaluru city" />
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-countries`}>
            Countries
          </label>
          <TagInput id={`${id}-countries`} lowercase={false} max={250} value={countries} onChange={(v) => setCountries(v.map((c) => c.toUpperCase().slice(0, 2)))} placeholder="IN" />
          <p className="c-hint">Two-letter codes: IN, US, AE…</p>
        </div>
      </div>
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-states`}>
            States <small>(optional)</small>
          </label>
          <TagInput id={`${id}-states`} lowercase={false} max={100} value={regions} onChange={setRegions} placeholder="Karnataka" />
          <p className="c-hint">Leave empty for the whole country.</p>
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-pins`}>
            PIN codes starting with <small>(optional)</small>
          </label>
          <TagInput id={`${id}-pins`} lowercase={false} max={500} value={prefixes} onChange={setPrefixes} placeholder="560" />
          <p className="c-hint">560 covers every PIN code beginning 560.</p>
        </div>
      </div>
      <label className="c-inline-check">
        <input type="checkbox" className="c-check-input" checked={cod} onChange={(e) => setCod(e.target.checked)} />
        Offer cash on delivery in this zone
      </label>

      <h3 style={{ fontSize: 15, margin: "18px 0 8px" }}>Rates</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {rates.map((r, i) => (
          <div key={i} className="c-rate-row">
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-name`}>
                Name
              </label>
              <input id={`${id}-r${i}-name`} className="c-input" value={r.name} maxLength={100} onChange={(e) => setRate(i, { name: e.target.value })} />
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-kind`}>
                Applies
              </label>
              <select id={`${id}-r${i}-kind`} className="c-select" value={r.kind} onChange={(e) => setRate(i, { kind: e.target.value as RateKind })}>
                {(Object.keys(KIND_LABEL) as RateKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-min`}>
                From {r.kind === "weight" ? "(g)" : ""}
              </label>
              <input id={`${id}-r${i}-min`} className="c-input" inputMode="decimal" disabled={r.kind === "flat"} value={r.min} onChange={(e) => setRate(i, { min: e.target.value })} />
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-max`}>
                To {r.kind === "weight" ? "(g)" : ""}
              </label>
              <input id={`${id}-r${i}-max`} className="c-input" inputMode="decimal" disabled={r.kind === "flat"} value={r.max} onChange={(e) => setRate(i, { max: e.target.value })} />
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-price`}>
                Price
              </label>
              <input id={`${id}-r${i}-price`} className="c-input" inputMode="decimal" value={r.price} onChange={(e) => setRate(i, { price: e.target.value })} placeholder="0 for free" />
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-free`}>
                Free over
              </label>
              <input id={`${id}-r${i}-free`} className="c-input" inputMode="decimal" value={r.freeOver} onChange={(e) => setRate(i, { freeOver: e.target.value })} placeholder="Never" />
            </div>
            <div className="c-field" style={{ margin: 0 }}>
              <label className="c-label" htmlFor={`${id}-r${i}-time`}>
                Delivery time
              </label>
              <input id={`${id}-r${i}-time`} className="c-input" value={r.deliveryTime} maxLength={60} onChange={(e) => setRate(i, { deliveryTime: e.target.value })} placeholder="2–4 days" />
            </div>
            <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Remove ${r.name || "rate"}`} disabled={rates.length === 1} onClick={() => setRates((rs) => rs.filter((_, n) => n !== i))}>
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="c-btn c-btn-sm"
        style={{ marginTop: 10 }}
        disabled={rates.length >= 20}
        onClick={() => setRates((rs) => [...rs, { name: "Express", kind: "flat", min: "", max: "", price: "", freeOver: "", deliveryTime: "1–2 days" }])}
      >
        <PlusIcon size={14} /> Add rate
      </button>
      <p className="c-hint">Shoppers see every rate that fits their parcel and choose; the cheapest is picked for them first. Weight comes from each variant&apos;s weight.</p>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Shipping: zones in matching order, each with the rates shoppers can choose from. */
export function ShippingView() {
  const ctx = useStore();
  const mod = moduleByKey("shipping");
  const [zones, setZones] = useState<Zone[] | undefined>();
  const [settings, setSettings] = useState<CheckoutSettings | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Zone | "new" | undefined>();
  const [removing, setRemoving] = useState<Zone | undefined>();
  const storeId = ctx?.store.id;

  const load = useCallback(() => {
    if (!storeId) return;
    api<{ zones: Zone[] }>(`/api/v1/stores/${storeId}/shipping/zones`)
      .then((r) => setZones(r.zones))
      .catch((err: unknown) => setError(errorMessage(err)));
    api<{ settings: CheckoutSettings }>(`/api/v1/stores/${storeId}/checkout-settings`)
      .then((r) => setSettings(r.settings))
      .catch(() => undefined);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ctx) return null;
  const { store, base, can } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number) => formatMoney(m, store.currency, locale, { compact: true });
  const manage = can("shipping.manage");
  const add = manage && (
    <button type="button" className="c-btn c-btn-primary" onClick={() => setEditing("new")}>
      <PlusIcon size={16} /> Add shipping zone
    </button>
  );

  async function move(index: number, by: number) {
    if (!zones) return;
    const next = [...zones];
    const [z] = next.splice(index, 1);
    next.splice(index + by, 0, z!);
    setZones(next);
    try {
      setZones((await api<{ zones: Zone[] }>(`/api/v1/stores/${store.id}/shipping/zone-order`, { method: "PUT", body: { ids: next.map((x) => x.id) } })).zones);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(z: Zone) {
    try {
      setZones((await api<{ zones: Zone[] }>(`/api/v1/stores/${store.id}/shipping/zones/${z.id}`, { method: "DELETE" })).zones);
      setRemoving(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const flat = settings
    ? !settings.deliveryEnabled
      ? "Delivery is turned off in Settings → Checkout."
      : `Without zones, every address pays the flat delivery fee of ${money(settings.deliveryFeeMinor)}${settings.freeDeliveryOverMinor !== null ? `, free over ${money(settings.freeDeliveryOverMinor)}` : ""}.`
    : "";

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} actions={zones && zones.length > 0 ? add : undefined} />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {zones === undefined ? (
        <div className="c-skeleton" role="status" aria-label="Loading shipping zones" style={{ height: 120 }} />
      ) : zones.length === 0 ? (
        <EmptyState icon={<ShippingIcon size={26} />} title="One delivery fee for everyone" actions={add}>
          {flat} Add zones to charge by city, state or PIN code, offer express delivery, price by weight, or turn off cash on delivery where it doesn&apos;t work for you.
        </EmptyState>
      ) : (
        <>
          <p className="c-muted" style={{ marginTop: 0 }}>
            The first zone that covers an address is used, so put specific zones (a city&apos;s PIN codes) above broad ones. Addresses no zone covers can&apos;t order delivery.
          </p>
          {zones.map((z, i) => (
            <div key={z.id} className="c-zone">
              <Card
                title={
                  <span className="c-zone-head">
                    <span>
                      {z.name}
                      <span className="c-cell-sub" style={{ fontWeight: 400 }}>
                        {[z.countries.join(", "), z.regions.length ? z.regions.join(", ") : null, z.postalPrefixes.length ? `PIN ${z.postalPrefixes.map((p) => `${p}…`).join(", ")}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Badge tone={z.codEnabled ? "success" : "neutral"}>{z.codEnabled ? "Cash on delivery" : "No cash on delivery"}</Badge>
                  </span>
                }
                actions={
                  manage && (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Move ${z.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}>
                        <ArrowUpIcon size={14} />
                      </button>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Move ${z.name} down`} disabled={i === zones.length - 1} onClick={() => void move(i, 1)}>
                        <ArrowDownIcon size={14} />
                      </button>
                      <button type="button" className="c-btn c-btn-sm" onClick={() => setEditing(z)}>
                        Edit
                      </button>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => setRemoving(z)}>
                        Delete
                      </button>
                    </span>
                  )
                }
                flush
              >
                <div className="c-table-wrap">
                  <table className="c-table c-table-stack">
                    <caption className="c-visually-hidden">Rates for {z.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Rate</th>
                        <th scope="col">When</th>
                        <th scope="col">Delivery time</th>
                        <th scope="col" className="c-num">
                          Price
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {z.rates.map((r) => (
                        <tr key={r.id}>
                          <td data-label="Rate">
                            <span className="c-cell-title">{r.name}</span>
                          </td>
                          <td data-label="When">{rangeText(r, money)}</td>
                          <td data-label="Delivery time">{r.deliveryTime ?? "—"}</td>
                          <td data-label="Price" className="c-num">
                            {r.priceMinor === 0 ? "Free" : money(r.priceMinor)}
                            {r.freeOverMinor !== null && <span className="c-cell-sub">Free over {money(r.freeOverMinor)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ))}
        </>
      )}
      <p className="c-hint" style={{ marginTop: 16 }}>
        Local pickup and the flat delivery fee are in <a href={`${base}/settings/checkout`}>Settings → Checkout</a>.
      </p>
      {editing && (
        <ZoneDialog
          storeId={store.id}
          currency={store.currency}
          country={store.country}
          zone={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onDone={(z) => {
            setZones(z);
            setEditing(undefined);
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(undefined)}
          title={`Delete ${removing.name}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setRemoving(undefined)}>
                Keep it
              </button>
              <button type="button" className="c-btn c-btn-danger" onClick={() => void remove(removing)}>
                Delete zone
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {zones && zones.length === 1 ? "With no zones left, every address pays the flat delivery fee again." : "Addresses in this zone fall through to the next zone that covers them, or can't order delivery."}
          </p>
        </Dialog>
      )}
    </Page>
  );
}
