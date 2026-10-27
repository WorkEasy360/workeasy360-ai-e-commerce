"use client";

import { useId, useState, type FormEvent } from "react";
import { Card } from "@workeasy/ui/react";
import { api, errorMessage, storefrontBase, type StoreResponse } from "../../../../lib/api";
import { COUNTRIES, CURRENCIES, LANGUAGES } from "../../../../lib/store-options";
import { SlugField } from "../../../slug-field";
import { useStore } from "../store-shell";

/** Every IANA zone the browser knows, falling back to the common ones. */
function timezones(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : COUNTRIES.map((c) => c.timezone);
  return known.includes(current) ? known : [current, ...known];
}

/**
 * General settings: the store's name, address, contact email and regional
 * defaults. Only owners may change the address, since it is the public URL
 * every shared link points at.
 */
export default function GeneralSettingsPage() {
  const ctx = useStore();
  const ids = { name: useId(), slug: useId(), email: useId(), country: useId(), currency: useId(), locale: useId(), tz: useId() };
  const store = ctx?.store;
  const [form, setForm] = useState(() => ({
    name: store?.name ?? "",
    slug: store?.slug ?? "",
    contactEmail: store?.contactEmail ?? "",
    country: store?.country ?? "IN",
    currency: store?.currency ?? "INR",
    defaultLocale: store?.defaultLocale ?? "en",
    timezone: store?.timezone ?? "Asia/Kolkata",
  }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | undefined>();
  if (!ctx || !store) return null;
  const canChangeAddress = ctx.can("store.manage");

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus(undefined);
  };

  const changes: Record<string, string | null> = {};
  if (form.name.trim() !== store.name) changes.name = form.name;
  if (canChangeAddress && form.slug !== store.slug) changes.slug = form.slug;
  if ((form.contactEmail.trim() || null) !== store.contactEmail) changes.contactEmail = form.contactEmail.trim() || null;
  if (form.country !== store.country) changes.country = form.country;
  if (form.currency !== store.currency) changes.currency = form.currency;
  if (form.defaultLocale !== store.defaultLocale) changes.defaultLocale = form.defaultLocale;
  if (form.timezone !== store.timezone) changes.timezone = form.timezone;
  const dirty = Object.keys(changes).length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ctx || !dirty) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const updated = await api<StoreResponse>(`/api/v1/stores/${store!.id}`, { method: "PATCH", body: changes });
      ctx.setStore(updated.store);
      setForm((f) => ({ ...f, name: updated.store.name, slug: updated.store.slug, contactEmail: updated.store.contactEmail ?? "" }));
      setStatus({ ok: true, text: "Settings saved." });
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="c-form" onSubmit={submit}>
      <Card title="Store details">
        <div className="c-form">
          <div className="c-field">
            <label className="c-label" htmlFor={ids.name}>
              Store name
            </label>
            <input id={ids.name} className="c-input" value={form.name} onChange={(e) => set("name")(e.target.value)} maxLength={120} required />
          </div>
          {canChangeAddress ? (
            <SlugField id={ids.slug} value={form.slug} current={store.slug} onChange={set("slug")} storefrontUrl={storefrontBase()} />
          ) : (
            <div className="c-field">
              <span className="c-label">Store address</span>
              <p className="c-hint">
                {storefrontBase().replace(/^https?:\/\//, "")}/s/{store.slug}. Only owners can change it.
              </p>
            </div>
          )}
          <div className="c-field">
            <label className="c-label" htmlFor={ids.email}>
              Contact email <small>(shown to shoppers)</small>
            </label>
            <input id={ids.email} className="c-input" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail")(e.target.value)} maxLength={254} autoComplete="email" />
          </div>
        </div>
      </Card>

      <Card title="Region and language">
        <div className="c-form-row">
          <div className="c-field">
            <label className="c-label" htmlFor={ids.country}>
              Country
            </label>
            <select id={ids.country} className="c-select" value={form.country} onChange={(e) => set("country")(e.target.value)}>
              {!COUNTRIES.some((c) => c.code === form.country) && <option value={form.country}>{form.country}</option>}
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="c-field">
            <label className="c-label" htmlFor={ids.currency}>
              Currency
            </label>
            <select id={ids.currency} className="c-select" value={form.currency} onChange={(e) => set("currency")(e.target.value)}>
              {!CURRENCIES.includes(form.currency) && <option value={form.currency}>{form.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="c-field">
            <label className="c-label" htmlFor={ids.locale}>
              Storefront language
            </label>
            <select id={ids.locale} className="c-select" value={form.defaultLocale} onChange={(e) => set("defaultLocale")(e.target.value)}>
              {!LANGUAGES.some((l) => l.code === form.defaultLocale) && <option value={form.defaultLocale}>{form.defaultLocale}</option>}
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="c-field">
            <label className="c-label" htmlFor={ids.tz}>
              Time zone
            </label>
            <select id={ids.tz} className="c-select" value={form.timezone} onChange={(e) => set("timezone")(e.target.value)}>
              {timezones(form.timezone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="c-hint" style={{ marginTop: 12 }}>
          Shoppers see your store in their browser&apos;s language when it is available, otherwise in this one.
        </p>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" }}>
        {status && (
          <p role={status.ok ? "status" : "alert"} className={status.ok ? "c-ok" : "c-error"}>
            {status.text}
          </p>
        )}
        <button type="submit" className="c-btn c-btn-primary" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
