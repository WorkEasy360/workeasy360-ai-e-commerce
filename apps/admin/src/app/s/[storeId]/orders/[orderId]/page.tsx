"use client";

import { use, useEffect, useId, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { ArrowLeftIcon, Badge, Card, CheckIcon, DownloadIcon, ExternalIcon, Page, PageHeader, PhoneIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { Thumb } from "../../../../../components/media";
import { api, errorMessage } from "../../../../../lib/api";
import { orderBadges, PAYMENT_LABELS, PROVIDER_LABELS, type OrderDetail } from "../../../../../lib/orders";
import { useStore } from "../../store-shell";
import { FulfilDialog, RefundDialog } from "./order-dialogs";

const EVENT_DOT: Record<string, string> = {
  placed: "var(--we-color-accent)",
  paid: "var(--we-color-success)",
  fulfilled: "var(--we-color-teal)",
  cancelled: "var(--we-color-danger)",
  refunded: "var(--we-color-warning)",
  payment_failed: "var(--we-color-danger)",
};

const REFUND_STATUS = { pending: { label: "Processing", tone: "warning" }, succeeded: { label: "Refunded", tone: "success" }, failed: { label: "Failed", tone: "danger" } } as const;

/** One order: what was bought, by whom, how they pay and receive it, its timeline, and the actions that move it along. */
export default function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const ctx = useStore();
  const noteId = useId();
  const [detail, setDetail] = useState<OrderDetail | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [restock, setRestock] = useState(true);
  const [dialog, setDialog] = useState<"fulfil" | "refund" | undefined>();
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<OrderDetail>(`/api/v1/stores/${storeId}/orders/${orderId}`)
      .then(setDetail)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, orderId]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const back = (
    <a className="c-back" href={`${base}/orders`}>
      <ArrowLeftIcon size={14} /> Orders
    </a>
  );
  if (!detail) {
    return (
      <Page>
        {back}
        {error ? (
          <p role="alert" className="c-error">
            {error}
          </p>
        ) : (
          <div className="c-skeleton" role="status" aria-label="Loading order" style={{ width: 240, height: 26 }} />
        )}
      </Page>
    );
  }

  const { order, items, events } = detail;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number) => formatMoney(m, order.currency, locale);
  const manage = can("orders.manage");
  const open = order.status === "open";

  const unfulfilled = items.reduce((n, i) => n + i.unfulfilledQuantity, 0);
  const canRefund = can("orders.refund") && order.paymentStatus !== "pending" && detail.refundableMinor > 0;
  const awaitingCard = order.paymentMethod === "card" && order.paymentStatus === "pending" && open;
  const finished = (d: OrderDetail) => {
    setDetail(d);
    setDialog(undefined);
  };

  async function act(path: "paid" | "fulfilled" | "cancel" | "notes", body?: unknown) {
    setBusy(path);
    setError(undefined);
    try {
      setDetail(await api<OrderDetail>(`/api/v1/stores/${store.id}/orders/${orderId}/${path}`, { method: "POST", ...(body === undefined ? {} : { body }) }));
      if (path === "notes") setNote("");
      if (path === "cancel") setCancelling(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(undefined);
    }
  }

  const phoneDigits = order.phone?.replace(/\D/g, "") ?? "";

  return (
    <Page>
      {back}
      <PageHeader
        title={`Order #${order.number}`}
        eyebrow={
          <>
            Sales
            {orderBadges(order).map((b) => (
              <Badge key={b.label} tone={b.tone}>
                {b.label}
              </Badge>
            ))}
          </>
        }
        subtitle={`Placed ${new Date(order.placedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} · ${PAYMENT_LABELS[order.paymentMethod]}`}
        actions={
          <>
            <a className="c-btn" href={`/api/v1/stores/${store.id}/orders/${order.id}/invoice.pdf`} download>
              <DownloadIcon size={16} /> Invoice
            </a>
            {canRefund && (
              <button type="button" className="c-btn" disabled={busy !== undefined} onClick={() => setDialog("refund")}>
                Refund
              </button>
            )}
            {manage && open && (
              <>
                <button type="button" className="c-btn c-btn-danger" disabled={busy !== undefined} onClick={() => setCancelling(true)}>
                  Cancel order
                </button>
                {unfulfilled > 0 && (
                  <button type="button" className={`c-btn${order.paymentStatus === "pending" && !awaitingCard ? "" : " c-btn-primary"}`} disabled={busy !== undefined} onClick={() => setDialog("fulfil")}>
                    {order.fulfillmentStatus === "partially_fulfilled" ? "Fulfil the rest" : "Fulfil items"}
                  </button>
                )}
                {order.paymentStatus === "pending" && !awaitingCard && (
                  <button type="button" className="c-btn c-btn-primary" disabled={busy !== undefined} onClick={() => void act("paid")}>
                    <CheckIcon size={16} /> {busy === "paid" ? "Saving…" : `Mark as paid (${money(order.totalMinor)})`}
                  </button>
                )}
              </>
            )}
          </>
        }
      />
      {error && (
        <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="c-detail">
        <div className="c-detail-main">
          <Card title={`Items (${items.reduce((n, i) => n + i.quantity, 0)})`}>
            <ul className="c-checklist">
              {items.map((i) => (
                <li key={i.id}>
                  <Thumb mediaId={i.imageId} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    {i.productId ? <a className="c-cell-title" href={`${base}/products/${i.productId}`}>{i.title}</a> : <strong>{i.title}</strong>}
                    <span>
                      {[i.variantTitle, i.sku ? `SKU ${i.sku}` : null, i.bookingAt ? `Booked for ${new Date(i.bookingAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : null, `${i.quantity} × ${money(i.unitPriceMinor)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {open && i.unfulfilledQuantity > 0 && i.unfulfilledQuantity < i.quantity && <Badge tone="warning">{i.unfulfilledQuantity} to ship</Badge>}
                  <strong style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{money(i.totalMinor)}</strong>
                </li>
              ))}
            </ul>
            <dl className="c-kv" style={{ marginTop: 12, gridTemplateColumns: "1fr auto", textAlign: "right" }}>
              <dt style={{ textAlign: "left" }}>Subtotal</dt>
              <dd>{money(order.subtotalMinor)}</dd>
              {order.discountMinor > 0 && (
                <>
                  <dt style={{ textAlign: "left" }}>
                    Discount {order.discountCode ? <code className="c-code">{order.discountCode}</code> : order.discountTitle}
                  </dt>
                  <dd>−{money(order.discountMinor)}</dd>
                </>
              )}
              {order.deliveryMethod === "delivery" && (
                <>
                  <dt style={{ textAlign: "left" }}>Delivery{order.shippingRateName ? ` · ${order.shippingRateName}` : ""}</dt>
                  <dd>{order.deliveryMinor === 0 ? "Free" : money(order.deliveryMinor)}</dd>
                </>
              )}
              {order.taxLabel && !order.pricesIncludeTax && (
                <>
                  <dt style={{ textAlign: "left" }}>{order.taxLabel}</dt>
                  <dd>{money(order.taxMinor)}</dd>
                </>
              )}
              <dt style={{ textAlign: "left", fontWeight: 700, color: "var(--we-color-text)" }}>Total</dt>
              <dd style={{ fontWeight: 800, fontSize: 17 }}>{money(order.totalMinor)}</dd>
              {order.taxLabel && order.pricesIncludeTax && order.taxMinor > 0 && (
                <>
                  <dt style={{ textAlign: "left" }}>{order.taxLabel} included</dt>
                  <dd>{money(order.taxMinor)}</dd>
                </>
              )}
              {order.refundedMinor > 0 && (
                <>
                  <dt style={{ textAlign: "left" }}>Refunded</dt>
                  <dd>−{money(order.refundedMinor)}</dd>
                  <dt style={{ textAlign: "left", fontWeight: 700, color: "var(--we-color-text)" }}>Net</dt>
                  <dd style={{ fontWeight: 700 }}>{money(order.totalMinor - order.refundedMinor)}</dd>
                </>
              )}
            </dl>
          </Card>

          {detail.fulfillments.length > 0 && (
            <Card title="Shipments">
              <ul className="c-checklist">
                {detail.fulfillments.map((f, n) => (
                  <li key={f.id}>
                    <div style={{ minWidth: 0 }}>
                      <strong>
                        Shipment {n + 1}
                        {f.carrier ? ` · ${f.carrier}` : ""}
                      </strong>
                      <span>
                        {[
                          f.trackingNumber,
                          f.items
                            .map((fi) => {
                              const item = items.find((i) => i.id === fi.orderItemId);
                              return `${fi.quantity} × ${item?.title ?? "item"}`;
                            })
                            .join(", "),
                          new Date(f.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {f.trackingUrl && (
                      <a className="c-btn c-btn-sm" style={{ marginLeft: "auto" }} href={f.trackingUrl} target="_blank" rel="noreferrer noopener">
                        Track <ExternalIcon size={13} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Timeline">
            <ol className="c-checklist">
              {events.map((e) => (
                <li key={e.id} style={{ alignItems: "flex-start" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 6, flex: "none", background: EVENT_DOT[e.kind] ?? "var(--we-color-border)" }} aria-hidden="true" />
                  <div>
                    <strong>{e.message}</strong>
                    <span>
                      {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            {manage && (
              <div className="c-field" style={{ marginTop: 12 }}>
                <label className="c-label" htmlFor={noteId}>
                  Add a note <small>(staff only)</small>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input id={noteId} className="c-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Called the customer to confirm the address" />
                  <button type="button" className="c-btn" disabled={!note.trim() || busy !== undefined} onClick={() => void act("notes", { note })}>
                    Add
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="c-detail-side">
          <Card title="Payment">
            <dl className="c-kv">
              <dt>Method</dt>
              <dd>{PAYMENT_LABELS[order.paymentMethod]}</dd>
              {order.paidAt && (
                <>
                  <dt>Paid</dt>
                  <dd>{new Date(order.paidAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
                </>
              )}
              {awaitingCard && order.paymentDueAt && (
                <>
                  <dt>Pay by</dt>
                  <dd>{new Date(order.paymentDueAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, then it&apos;s cancelled and stock released</dd>
                </>
              )}
            </dl>
            {detail.payments.filter((p) => p.status !== "created").length > 0 && (
              <ul className="c-checklist" style={{ marginTop: 12 }}>
                {detail.payments
                  .filter((p) => p.status !== "created")
                  .map((p) => (
                    <li key={p.id}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{money(p.amountMinor)}</strong>
                        <span>
                          {p.provider === "manual"
                            ? `${PAYMENT_LABELS[p.method as keyof typeof PAYMENT_LABELS] ?? "Offline payment"} · marked paid`
                            : [PROVIDER_LABELS[p.provider], p.method, p.providerPaymentId, p.mode === "test" ? "test mode" : null].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <span style={{ marginLeft: "auto" }}>
                        <Badge tone={p.status === "succeeded" ? "success" : "danger"}>{p.status === "succeeded" ? "Received" : "Failed"}</Badge>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {detail.refunds.length > 0 && (
              <ul className="c-checklist" style={{ marginTop: 12 }} aria-label="Refunds">
                {detail.refunds.map((r) => (
                  <li key={r.id}>
                    <div style={{ minWidth: 0 }}>
                      <strong>Refund {money(r.amountMinor)}</strong>
                      <span>{[r.paymentId ? "to the card" : "outside the store", r.reason, r.failureCode, new Date(r.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span style={{ marginLeft: "auto" }}>
                      <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Customer">
            <dl className="c-kv">
              <dt>Name</dt>
              <dd>{order.name}</dd>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${order.email}?subject=${encodeURIComponent(`Your order #${order.number}`)}`}>{order.email}</a>
              </dd>
              {order.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${order.phone}`}>{order.phone}</a>
                  </dd>
                </>
              )}
            </dl>
            {phoneDigits.length >= 8 && (
              <a className="c-btn c-btn-sm" style={{ marginTop: 12 }} href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hi ${order.name}, about your order #${order.number}:`)}`} target="_blank" rel="noreferrer">
                <PhoneIcon size={14} /> Message on WhatsApp
              </a>
            )}
          </Card>
          <Card title={order.deliveryMethod === "pickup" ? "Pickup" : "Delivery"}>
            {order.deliveryMethod === "delivery" && order.address ? (
              <address style={{ fontStyle: "normal", lineHeight: 1.6 }}>
                {order.name}
                <br />
                {order.address.line1}
                {order.address.line2 && (
                  <>
                    <br />
                    {order.address.line2}
                  </>
                )}
                <br />
                {[order.address.city, order.address.state, order.address.postalCode].filter(Boolean).join(", ")}
                <br />
                {order.address.country}
              </address>
            ) : (
              <p className="c-muted" style={{ margin: 0 }}>
                {order.deliveryMethod === "pickup" ? "The customer will collect from your shop." : "Nothing to ship: downloads and bookings."}
              </p>
            )}
          </Card>
          {order.note && (
            <Card title="Customer's note">
              <p style={{ margin: 0, whiteSpace: "pre-line" }}>{order.note}</p>
            </Card>
          )}
        </div>
      </div>

      {dialog === "fulfil" && <FulfilDialog storeId={store.id} detail={detail} onDone={finished} onClose={() => setDialog(undefined)} />}
      {dialog === "refund" && <RefundDialog storeId={store.id} detail={detail} locale={locale} onDone={finished} onClose={() => setDialog(undefined)} />}

      {cancelling && (
        <Dialog
          open
          onClose={() => setCancelling(false)}
          title={`Cancel order #${order.number}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setCancelling(false)}>
                Keep order
              </button>
              <button type="button" className="c-btn c-btn-danger" disabled={busy !== undefined} onClick={() => void act("cancel", { restock })}>
                {busy === "cancel" ? "Cancelling…" : "Cancel order"}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>The order stays in your records, marked cancelled. This can&apos;t be undone.</p>
          {order.paymentStatus !== "pending" && detail.refundableMinor > 0 && <p className="c-error">This order is paid. Cancelling doesn&apos;t refund it: use Refund to return the money.</p>}
          <label className="c-inline-check">
            <input type="checkbox" className="c-check-input" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            Put the items back in stock
          </label>
        </Dialog>
      )}
    </Page>
  );
}
