"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { parseMoney, toDecimalString } from "@workeasy/commerce";
import { Card } from "@workeasy/ui/react";
import { api, ApiError, errorMessage } from "../../../../../lib/api";
import type { CheckoutSettings } from "../../../../../lib/orders";
import { useStore } from "../../store-shell";

interface Form {
  deliveryEnabled: boolean;
  deliveryFee: string;
  freeOver: string;
  pickupEnabled: boolean;
  pickupAddress: string;
  codEnabled: boolean;
  codInstructions: string;
  bankEnabled: boolean;
  bankInstructions: string;
  upiEnabled: boolean;
  upiId: string;
  upiInstructions: string;
  whatsappNumber: string;
  telegramUsername: string;
  orderNoteEnabled: boolean;
}

function toForm(s: CheckoutSettings, currency: string): Form {
  return {
    deliveryEnabled: s.deliveryEnabled,
    deliveryFee: s.deliveryFeeMinor ? toDecimalString(s.deliveryFeeMinor, currency) : "",
    freeOver: s.freeDeliveryOverMinor === null ? "" : toDecimalString(s.freeDeliveryOverMinor, currency),
    pickupEnabled: s.pickupEnabled,
    pickupAddress: s.pickupAddress ?? "",
    codEnabled: s.codEnabled,
    codInstructions: s.codInstructions ?? "",
    bankEnabled: s.bankEnabled,
    bankInstructions: s.bankInstructions ?? "",
    upiEnabled: s.upiEnabled,
    upiId: s.upiId ?? "",
    upiInstructions: s.upiInstructions ?? "",
    whatsappNumber: s.whatsappNumber ?? "",
    telegramUsername: s.telegramUsername ?? "",
    orderNoteEnabled: s.orderNoteEnabled,
  };
}

function Toggle({ checked, onChange, title, text, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string; children?: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label className="c-radio-card">
        <input type="checkbox" className="c-check-input" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <strong>{title}</strong>
          <span>{text}</span>
        </span>
      </label>
      {checked && children && <div style={{ paddingLeft: 30, display: "grid", gap: 12 }}>{children}</div>}
    </div>
  );
}

/**
 * How shoppers pay and receive orders: delivery charges and pickup, cash on
 * delivery, bank transfer and UPI with your own instructions, and ordering
 * through WhatsApp or Telegram. Card payments arrive with Payments & Finances.
 */
export default function CheckoutSettingsPage() {
  const ctx = useStore();
  const ids = { fee: useId(), free: useId(), pickup: useId(), cod: useId(), bank: useId(), upi: useId(), upiNote: useId(), wa: useId(), tg: useId() };
  const [form, setForm] = useState<Form | undefined>();
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | undefined>();
  const storeId = ctx?.store.id;
  const currency = ctx?.store.currency ?? "INR";

  useEffect(() => {
    if (!storeId) return;
    api<{ settings: CheckoutSettings }>(`/api/v1/stores/${storeId}/checkout-settings`)
      .then((r) => {
        const f = toForm(r.settings, currency);
        setForm(f);
        setSaved(JSON.stringify(f));
      })
      .catch((err: unknown) => setStatus({ ok: false, text: errorMessage(err) }));
  }, [storeId, currency]);

  if (!ctx) return null;
  if (!form) return status ? <p role="alert" className="c-error">{status.text}</p> : <div className="c-skeleton" role="status" aria-label="Loading checkout settings" />;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm({ ...form, [key]: value });
    setStatus(undefined);
  };
  const dirty = JSON.stringify(form) !== saved;

  async function save() {
    if (!form || !storeId) return;
    const fee = form.deliveryFee.trim() ? parseMoney(form.deliveryFee, currency) : 0;
    const freeOver = form.freeOver.trim() ? parseMoney(form.freeOver, currency) : null;
    if (fee === undefined || freeOver === undefined) {
      setStatus({ ok: false, text: "Enter delivery amounts such as 50 or 999.00" });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ settings: CheckoutSettings }>(`/api/v1/stores/${storeId}/checkout-settings`, {
        method: "PUT",
        body: {
          deliveryEnabled: form.deliveryEnabled,
          deliveryFeeMinor: fee,
          freeDeliveryOverMinor: freeOver,
          pickupEnabled: form.pickupEnabled,
          pickupAddress: form.pickupAddress,
          codEnabled: form.codEnabled,
          codInstructions: form.codInstructions,
          bankEnabled: form.bankEnabled,
          bankInstructions: form.bankInstructions,
          upiEnabled: form.upiEnabled,
          upiId: form.upiId,
          upiInstructions: form.upiInstructions,
          whatsappNumber: form.whatsappNumber,
          telegramUsername: form.telegramUsername,
          orderNoteEnabled: form.orderNoteEnabled,
        },
      });
      const f = toForm(r.settings, currency);
      setForm(f);
      setSaved(JSON.stringify(f));
      setStatus({ ok: true, text: "Checkout settings saved." });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof ApiError && err.problem.errors?.[0] ? err.problem.errors[0].message : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const money = (id: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <span className="c-input-group">
      <span>{currency}</span>
      <input id={id} className="c-input" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </span>
  );

  return (
    <div className="c-form">
      <Card title="Delivery">
        <div className="c-form">
          <Toggle checked={form.deliveryEnabled} onChange={(v) => set("deliveryEnabled", v)} title="Deliver to shoppers" text="Shoppers enter an address at checkout.">
            <div className="c-form-row">
              <div className="c-field">
                <label className="c-label" htmlFor={ids.fee}>
                  Delivery charge
                </label>
                {money(ids.fee, form.deliveryFee, (v) => set("deliveryFee", v), "0 for free delivery")}
              </div>
              <div className="c-field">
                <label className="c-label" htmlFor={ids.free}>
                  Free delivery on orders over <small>(optional)</small>
                </label>
                {money(ids.free, form.freeOver, (v) => set("freeOver", v), "Never")}
              </div>
            </div>
            <p className="c-hint">Zones and weight-based rates arrive with the Shipping module.</p>
          </Toggle>
          <Toggle checked={form.pickupEnabled} onChange={(v) => set("pickupEnabled", v)} title="Local pickup" text="Shoppers collect from your shop for free.">
            <div className="c-field">
              <label className="c-label" htmlFor={ids.pickup}>
                Pickup address and hours
              </label>
              <textarea id={ids.pickup} className="c-textarea" rows={2} maxLength={500} value={form.pickupAddress} onChange={(e) => set("pickupAddress", e.target.value)} />
            </div>
          </Toggle>
        </div>
      </Card>

      <Card title="Ways to pay">
        <div className="c-form">
          <Toggle checked={form.upiEnabled} onChange={(v) => set("upiEnabled", v)} title="UPI" text="Shoppers pay to your UPI ID after ordering; you mark the order paid.">
            <div className="c-form-row">
              <div className="c-field">
                <label className="c-label" htmlFor={ids.upi}>
                  UPI ID
                </label>
                <input id={ids.upi} className="c-input" value={form.upiId} placeholder="yourshop@okhdfcbank" onChange={(e) => set("upiId", e.target.value.trim())} />
              </div>
              <div className="c-field">
                <label className="c-label" htmlFor={ids.upiNote}>
                  Note for shoppers <small>(optional)</small>
                </label>
                <input id={ids.upiNote} className="c-input" value={form.upiInstructions} maxLength={1000} placeholder="Send a screenshot on WhatsApp" onChange={(e) => set("upiInstructions", e.target.value)} />
              </div>
            </div>
          </Toggle>
          <Toggle checked={form.bankEnabled} onChange={(v) => set("bankEnabled", v)} title="Bank transfer" text="Shoppers see your bank details after ordering.">
            <div className="c-field">
              <label className="c-label" htmlFor={ids.bank}>
                Bank details
              </label>
              <textarea id={ids.bank} className="c-textarea" rows={3} maxLength={2000} value={form.bankInstructions} placeholder={"Account name, account number, IFSC"} onChange={(e) => set("bankInstructions", e.target.value)} />
            </div>
          </Toggle>
          <Toggle checked={form.codEnabled} onChange={(v) => set("codEnabled", v)} title="Cash on delivery" text="Shoppers pay when the order arrives.">
            <div className="c-field">
              <label className="c-label" htmlFor={ids.cod}>
                Note for shoppers <small>(optional)</small>
              </label>
              <input id={ids.cod} className="c-input" value={form.codInstructions} maxLength={1000} placeholder="Please keep exact change ready" onChange={(e) => set("codInstructions", e.target.value)} />
            </div>
          </Toggle>
          <p className="c-hint">Card payments with Razorpay and Stripe arrive with Payments &amp; Finances.</p>
        </div>
      </Card>

      <Card title="Chat ordering">
        <div className="c-form">
          <p className="c-hint" style={{ fontSize: 14 }}>
            Let shoppers send their whole cart to you as a ready-made message, and arrange payment in the chat. Leave blank to turn off.
          </p>
          <div className="c-form-row">
            <div className="c-field">
              <label className="c-label" htmlFor={ids.wa}>
                WhatsApp number <small>(with country code)</small>
              </label>
              <input id={ids.wa} className="c-input" inputMode="tel" value={form.whatsappNumber} placeholder="91 98765 43210" onChange={(e) => set("whatsappNumber", e.target.value)} />
            </div>
            <div className="c-field">
              <label className="c-label" htmlFor={ids.tg}>
                Telegram username
              </label>
              <span className="c-input-group">
                <span>@</span>
                <input id={ids.tg} className="c-input" value={form.telegramUsername} placeholder="yourshop" onChange={(e) => set("telegramUsername", e.target.value.replace(/^@/, ""))} />
              </span>
            </div>
          </div>
          <label className="c-inline-check">
            <input type="checkbox" className="c-check-input" checked={form.orderNoteEnabled} onChange={(e) => set("orderNoteEnabled", e.target.checked)} />
            Let shoppers add a note to their order
          </label>
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" }}>
        {status && (
          <p role={status.ok ? "status" : "alert"} className={status.ok ? "c-ok" : "c-error"}>
            {status.text}
          </p>
        )}
        <button type="button" className="c-btn c-btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
