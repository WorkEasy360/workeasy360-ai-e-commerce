"use client";

import { useId, useState } from "react";
import { formatMoney, parseMoney, toDecimalString } from "@workeasy/commerce";
import { Dialog } from "@workeasy/ui/client";
import { api, ApiError, errorMessage } from "../../../../../lib/api";
import { PROVIDER_LABELS, type OrderDetail } from "../../../../../lib/orders";

type Items = OrderDetail["items"];

function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.problem.errors ? Object.fromEntries(err.problem.errors.map((e) => [e.field, e.message])) : {};
}

/** A quantity stepper per line, from 0 to `max`. */
function QuantityRows({ items, max, value, onChange, label }: { items: Items; max: (i: Items[number]) => number; value: Record<string, number>; onChange: (v: Record<string, number>) => void; label: string }) {
  return (
    <table className="c-table" style={{ marginBottom: 4 }}>
      <caption className="c-visually-hidden">{label}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col" className="c-num">
            {label}
          </th>
        </tr>
      </thead>
      <tbody>
        {items
          .filter((i) => max(i) > 0)
          .map((i) => (
            <tr key={i.id}>
              <td>
                <span className="c-cell-title">{i.title}</span>
                {i.variantTitle && <span className="c-cell-sub">{i.variantTitle}</span>}
              </td>
              <td className="c-num">
                <input
                  className="c-input"
                  type="number"
                  min={0}
                  max={max(i)}
                  value={value[i.id] ?? 0}
                  aria-label={`${label}: ${i.title}`}
                  onChange={(e) => onChange({ ...value, [i.id]: Math.max(0, Math.min(max(i), Math.floor(Number(e.target.value) || 0))) })}
                  style={{ width: 84 }}
                />{" "}
                <span className="c-muted">of {max(i)}</span>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** Ship some or all of what's left, with optional tracking the customer is emailed. */
export function FulfilDialog({ storeId, detail, onDone, onClose }: { storeId: string; detail: OrderDetail; onDone: (d: OrderDetail) => void; onClose: () => void }) {
  const ids = { carrier: useId(), number: useId(), url: useId() };
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(detail.items.map((i) => [i.id, i.unfulfilledQuantity])));
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const chosen = Object.entries(qty).filter(([, q]) => q > 0);
  const physical = detail.order.deliveryMethod === "delivery";

  async function save() {
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      onDone(
        await api<OrderDetail>(`/api/v1/stores/${storeId}/orders/${detail.order.id}/fulfillments`, {
          method: "POST",
          body: { items: chosen.map(([orderItemId, quantity]) => ({ orderItemId, quantity })), carrier: carrier || null, trackingNumber: trackingNumber || null, trackingUrl: trackingUrl || null, notify },
        }),
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Fulfil order #${detail.order.number}`}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : `Fulfil ${chosen.reduce((n, [, q]) => n + q, 0)} item${chosen.reduce((n, [, q]) => n + q, 0) === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <QuantityRows items={detail.items} max={(i) => i.unfulfilledQuantity} value={qty} onChange={setQty} label="Ship now" />
      {physical && (
        <div className="c-form-row">
          <div className="c-field">
            <label className="c-label" htmlFor={ids.carrier}>
              Carrier <small>(optional)</small>
            </label>
            <input id={ids.carrier} className="c-input" value={carrier} maxLength={100} onChange={(e) => setCarrier(e.target.value)} placeholder="Delhivery, Blue Dart, India Post…" />
          </div>
          <div className="c-field">
            <label className="c-label" htmlFor={ids.number}>
              Tracking number <small>(optional)</small>
            </label>
            <input id={ids.number} className="c-input" value={trackingNumber} maxLength={100} onChange={(e) => setTrackingNumber(e.target.value)} />
          </div>
        </div>
      )}
      {physical && (
        <div className="c-field">
          <label className="c-label" htmlFor={ids.url}>
            Tracking link <small>(optional)</small>
          </label>
          <input id={ids.url} className="c-input" type="url" value={trackingUrl} maxLength={500} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://" aria-invalid={errors.trackingUrl ? true : undefined} />
          {errors.trackingUrl && <p className="c-error">{errors.trackingUrl}</p>}
        </div>
      )}
      <label className="c-inline-check">
        <input type="checkbox" className="c-check-input" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Email the customer {physical ? "that it's on its way, with tracking" : "that it's ready"}
      </label>
      {error && !errors.trackingUrl && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/**
 * Refund part or all of a paid order: back to the card through the gateway
 * when it was paid online, or record money returned some other way.
 */
export function RefundDialog({ storeId, detail, locale, onDone, onClose }: { storeId: string; detail: OrderDetail; locale: string; onDone: (d: OrderDetail) => void; onClose: () => void }) {
  const ids = { amount: useId(), reason: useId() };
  const { order } = detail;
  const online = detail.payments.find((p) => p.status === "succeeded" && p.provider !== "manual");
  const [method, setMethod] = useState<"gateway" | "manual">(online ? "gateway" : "manual");
  const [amount, setAmount] = useState(toDecimalString(detail.refundableMinor, order.currency));
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amountMinor = parseMoney(amount, order.currency);
  const money = (m: number) => formatMoney(m, order.currency, locale);
  const tooMuch = amountMinor !== undefined && amountMinor > detail.refundableMinor;

  async function save() {
    if (amountMinor === undefined || amountMinor <= 0) {
      setErrors({ amountMinor: "Enter an amount to refund" });
      return;
    }
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      onDone(
        await api<OrderDetail>(`/api/v1/stores/${storeId}/orders/${order.id}/refunds`, {
          method: "POST",
          body: { amountMinor, method, reason: reason || null, restock: Object.entries(restock).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })) },
        }),
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Refund order #${order.number}`}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-danger" disabled={busy || amountMinor === undefined || amountMinor <= 0 || tooMuch} onClick={() => void save()}>
            {busy ? "Refunding…" : `Refund ${amountMinor ? money(amountMinor) : ""}`.trim()}
          </button>
        </>
      }
    >
      <div className="c-radio-row">
        {online && (
          <label className="c-radio-card">
            <input type="radio" name="refund-method" className="c-check-input" checked={method === "gateway"} onChange={() => setMethod("gateway")} />
            <span>
              <strong>Refund to the customer&apos;s {online.method === "upi" ? "UPI account" : "card"}</strong>
              <span>
                Sent through {PROVIDER_LABELS[online.provider]}
                {online.mode === "test" ? " (test mode)" : ""}. Banks usually take 5 to 7 working days.
              </span>
            </span>
          </label>
        )}
        <label className="c-radio-card">
          <input type="radio" name="refund-method" className="c-check-input" checked={method === "manual"} onChange={() => setMethod("manual")} />
          <span>
            <strong>I returned the money myself</strong>
            <span>Cash, UPI or bank transfer outside the store. This records it; no money moves.</span>
          </span>
        </label>
      </div>
      <div className="c-form-row" style={{ marginTop: 12 }}>
        <div className="c-field">
          <label className="c-label" htmlFor={ids.amount}>
            Amount ({order.currency})
          </label>
          <input id={ids.amount} className="c-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={tooMuch || errors.amountMinor ? true : undefined} />
          <p className={tooMuch || errors.amountMinor ? "c-error" : "c-hint"}>{errors.amountMinor ?? (tooMuch ? `At most ${money(detail.refundableMinor)}` : `Up to ${money(detail.refundableMinor)} left to refund`)}</p>
        </div>
        <div className="c-field">
          <label className="c-label" htmlFor={ids.reason}>
            Reason <small>(optional, staff only)</small>
          </label>
          <input id={ids.reason} className="c-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in transit" />
        </div>
      </div>
      {detail.items.some((i) => i.productType === "physical") && (
        <>
          <p className="c-label" style={{ margin: "8px 0 4px" }}>
            Put items back in stock <small>(optional)</small>
          </p>
          <QuantityRows items={detail.items.filter((i) => i.productType === "physical")} max={(i) => i.quantity} value={restock} onChange={setRestock} label="Restock" />
        </>
      )}
      {error && !errors.amountMinor && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
