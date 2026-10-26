"use client";

import { useEffect, useId, useState } from "react";
import { Card } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../lib/api";

interface Tax {
  enabled: boolean;
  pricesIncludeTax: boolean;
  defaultRateBps: number;
  taxShipping: boolean;
  label: string;
  registrationNumber: string | null;
}

/** GST or VAT: whether prices include it, the usual rate, and the number printed on invoices. */
export function TaxCard({ storeId, canEdit }: { storeId: string; canEdit: boolean }) {
  const id = useId();
  const [tax, setTax] = useState<Tax | undefined>();
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<{ tax: Tax }>(`/api/v1/stores/${storeId}/tax-settings`)
      .then((r) => {
        setTax(r.tax);
        setRate(String(r.tax.defaultRateBps / 100));
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  if (!tax) return <Card title="Tax">{error ? <p className="c-error">{error}</p> : <div className="c-skeleton" role="status" aria-label="Loading tax settings" />}</Card>;
  const set = <K extends keyof Tax>(key: K, value: Tax[K]) => {
    setTax({ ...tax, [key]: value });
    setStatus(undefined);
  };

  async function save() {
    const bps = Math.round(Number(rate) * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
      setError("Enter a rate between 0 and 50%");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ tax: Tax }>(`/api/v1/stores/${storeId}/tax-settings`, { method: "PUT", body: { ...tax!, defaultRateBps: bps } });
      setTax(r.tax);
      setStatus("Saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !canEdit || !tax.enabled;
  return (
    <Card title="Tax">
      <label className="c-inline-check">
        <input type="checkbox" className="c-check-input" disabled={!canEdit} checked={tax.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Charge {tax.label || "tax"} on orders
      </label>
      <div className="c-form-row" style={{ marginTop: 12 }}>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-label`}>
            Tax name
          </label>
          <select id={`${id}-label`} className="c-select" disabled={disabled} value={tax.label} onChange={(e) => set("label", e.target.value)}>
            <option value="GST">GST</option>
            <option value="VAT">VAT</option>
            <option value="Tax">Sales tax</option>
          </select>
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-rate`}>
            Usual rate (%)
          </label>
          <input id={`${id}-rate`} className="c-input" inputMode="decimal" disabled={disabled} value={rate} onChange={(e) => setRate(e.target.value)} />
          <p className="c-hint">Products can have their own rate, such as 5% GST on packaged tea.</p>
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-reg`}>
            {tax.label === "GST" ? "GSTIN" : "Registration number"} <small>(optional)</small>
          </label>
          <input
            id={`${id}-reg`}
            className="c-input"
            disabled={disabled}
            maxLength={30}
            style={{ textTransform: "uppercase" }}
            value={tax.registrationNumber ?? ""}
            onChange={(e) => set("registrationNumber", e.target.value || null)}
            placeholder={tax.label === "GST" ? "29ABCDE1234F1Z5" : ""}
          />
          <p className="c-hint">Printed on invoices.</p>
        </div>
      </div>
      <div className="c-radio-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <label className="c-radio-card">
          <input type="radio" className="c-check-input" name={`${id}-incl`} disabled={disabled} checked={tax.pricesIncludeTax} onChange={() => set("pricesIncludeTax", true)} />
          <span>
            <strong>Prices include {tax.label}</strong>
            <span>Usual in India: ₹118 on the shelf is what shoppers pay; ₹18 of it is shown as GST.</span>
          </span>
        </label>
        <label className="c-radio-card">
          <input type="radio" className="c-check-input" name={`${id}-incl`} disabled={disabled} checked={!tax.pricesIncludeTax} onChange={() => set("pricesIncludeTax", false)} />
          <span>
            <strong>Add {tax.label} at checkout</strong>
            <span>₹100 on the shelf, plus tax in the cart total.</span>
          </span>
        </label>
      </div>
      <label className="c-inline-check" style={{ marginTop: 12 }}>
        <input type="checkbox" className="c-check-input" disabled={disabled} checked={tax.taxShipping} onChange={(e) => set("taxShipping", e.target.checked)} />
        Charge {tax.label} on delivery fees too
      </label>
      {canEdit && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
          <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save tax settings"}
          </button>
          {status && (
            <span className="c-muted" role="status">
              {status}
            </span>
          )}
          {error && (
            <span className="c-error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
