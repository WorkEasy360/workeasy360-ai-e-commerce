"use client";

import { useId, useState, type FormEvent } from "react";
import { api, errorMessage, storefrontBase, type StoreResponse } from "../lib/api";
import { COUNTRIES, CURRENCIES, slugify } from "../lib/store-options";
import { SlugField } from "./slug-field";

/**
 * Creating a store: a name and an address are all it takes; country sets
 * sensible currency and time-zone defaults. The creator becomes its owner
 * and lands on the dashboard's setup checklist.
 */
export function CreateStore({ first, greeting }: { first: boolean; greeting: string }) {
  const ids = { name: useId(), slug: useId(), country: useId(), currency: useId() };
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [country, setCountry] = useState("IN");
  const [currency, setCurrency] = useState("INR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function onName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function onCountry(code: string) {
    setCountry(code);
    const match = COUNTRIES.find((c) => c.code === code);
    if (match) setCurrency(match.currency);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const timezone = COUNTRIES.find((c) => c.code === country)?.timezone ?? "Asia/Kolkata";
    try {
      const created = await api<StoreResponse>("/api/v1/stores", { method: "POST", body: { name, slug, country, currency, timezone } });
      window.location.assign(`/s/${created.store.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="c-card c-form" onSubmit={submit}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>{first ? `Let's set up your store, ${greeting}` : "Create another store"}</h1>
        <p className="c-subtitle" style={{ marginTop: 4 }}>
          You can change all of this later in Settings.
        </p>
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={ids.name}>
          Store name
        </label>
        <input id={ids.name} className="c-input" value={name} onChange={(e) => onName(e.target.value)} maxLength={120} required placeholder="For example: Chai & Co" />
      </div>
      <SlugField
        id={ids.slug}
        value={slug}
        storefrontUrl={storefrontBase()}
        onChange={(value) => {
          setSlugEdited(true);
          setSlug(value);
        }}
      />
      <div className="c-form-row">
        <div className="c-field">
          <label className="c-label" htmlFor={ids.country}>
            Country
          </label>
          <select id={ids.country} className="c-select" value={country} onChange={(e) => onCountry(e.target.value)}>
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
          <select id={ids.currency} className="c-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      <button type="submit" className="c-btn c-btn-brand" disabled={busy || name.trim() === "" || slug.length < 3}>
        {busy ? "Creating your store…" : "Create store"}
      </button>
    </form>
  );
}
