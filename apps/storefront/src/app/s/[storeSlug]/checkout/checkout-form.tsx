"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { formatMoney } from "@workeasy/commerce";
import { ProductImage } from "../../../../components/shop";
import { useCart } from "../../../../lib/cart";
import { pay, type PaymentStart } from "../../../../lib/pay";
import { useI18n } from "../../../../components/i18n";
import { track } from "../../../../lib/track";
import { useQuote } from "../../../../lib/quote";
import type { CheckoutOptions, DeliveryMethod, PaymentMethod } from "../../../../lib/stores";


interface Problem {
  item?: number;
  message: string;
}

function Field({ label, id, error, children }: { label: string; id: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <p className="c-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Checkout: who you are, how you get it, how you pay. The order is priced
 * and stock-checked by the shop when it's placed; anything that changed
 * since the cart is explained here instead of failing silently.
 */
export function CheckoutForm({
  slug,
  storeName,
  currency,
  country,
  locale,
  checkout,
}: {
  slug: string;
  storeName: string;
  currency: string;
  country: string;
  locale: string;
  checkout: CheckoutOptions;
}) {
  const ids = { name: useId(), email: useId(), phone: useId(), line1: useId(), line2: useId(), city: useId(), state: useId(), pin: useId(), note: useId(), code: useId() };
  const cart = useCart(slug);
  const { t } = useI18n();
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [address, setAddress] = useState({ line1: "", line2: "", city: "", state: "", postalCode: "" });
  const [chosenDelivery, setDelivery] = useState<DeliveryMethod | undefined>();
  const [rateId, setRateId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [discountCode, setDiscountCode] = useState<string | null>(null);
  // Shipping is priced once the PIN code is in; the street doesn't change it.
  const shipTo = address.postalCode.trim().length >= 3 ? { country, state: address.state.trim() || null, postalCode: address.postalCode.trim() } : null;
  const { quote } = useQuote(slug, cart.lines, {
    deliveryMethod: chosenDelivery,
    address: shipTo,
    rateId,
    discountCode,
    email: /^\S+@\S+\.\S+$/.test(contact.email) ? contact.email : null,
  });
  const [chosenPayment, setPayment] = useState<PaymentMethod | undefined>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Problem[]>([]);
  const money = (m: number) => formatMoney(m, currency, locale);
  const [checkoutId, setCheckoutId] = useState<string | undefined>();
  const hasItems = cart.lines.length > 0;
  useEffect(() => {
    if (hasItems) track(slug, { type: "checkout_start" });
  }, [slug, hasItems]);
  const copy = (m: PaymentMethod) => {
    const key = m === "card" && checkout.card?.provider === "stripe" ? "stripe" : m;
    return { title: t(`pay.${key}.title`), text: t(`pay.${key}.text`) };
  };

  /** Saves the shopper's details with their cart once there's an email, so the shop can follow up if they don't finish. */
  async function saveCheckout() {
    if (!/^\S+@\S+\.\S+$/.test(contact.email) || cart.lines.length === 0) return;
    try {
      const res = await fetch(`/public/v1/stores/${slug}/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          checkoutId,
          email: contact.email,
          name: contact.name || null,
          phone: contact.phone || null,
          items: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        }),
      });
      if (res.ok && res.status !== 204) setCheckoutId(((await res.json()) as { checkoutId: string }).checkoutId);
    } catch {
      // Best effort: checkout works the same without it.
    }
  }

  const options = quote?.deliveryOptions ?? [];
  const delivery = chosenDelivery && options.includes(chosenDelivery) ? chosenDelivery : options[0];
  const pricing = quote?.pricing && quote.pricing.deliveryMethod === delivery ? quote.pricing : undefined;
  // Cash on delivery can be off for some delivery areas.
  const methods = checkout.paymentMethods.filter((m) => !(m === "cod" && delivery === "delivery" && pricing && !pricing.codAllowed));
  const payment = chosenPayment && methods.includes(chosenPayment) ? chosenPayment : methods[0];
  const sums = pricing;
  const awaitingAddress = delivery === "delivery" && pricing?.shippingNeedsAddress === true;
  const undeliverable = delivery === "delivery" && pricing !== undefined && !pricing.shippingNeedsAddress && !pricing.deliverable;

  if (cart.lines.length === 0) {
    return (
      <div className="sf-empty">
        <h2>{t("cart.empty")}</h2>
        <p>{t("checkout.emptyText")}</p>
        <a className="sf-btn sf-btn-brand" href={`/s/${slug}/products`}>
          {t("cart.start")}
        </a>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!delivery || !payment) return;
    setBusy(true);
    setFieldErrors({});
    setProblems([]);
    try {
      const res = await fetch(`/public/v1/stores/${slug}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, bookingAt: l.bookingAt })),
          email: contact.email,
          name: contact.name,
          phone: contact.phone || null,
          deliveryMethod: delivery,
          address: delivery === "delivery" ? { ...address, line2: address.line2 || null, state: address.state || null } : null,
          paymentMethod: payment,
          note: note || null,
          checkoutId,
          discountCode,
          rateId: pricing?.shippingRateId ?? null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        order?: { token: string };
        payment?: PaymentStart | null;
        title?: string;
        errors?: Array<{ field: string; message: string }>;
        problems?: Problem[];
      };
      if (res.ok && body.order) {
        cart.clear();
        const orderPage = `/s/${slug}/order/${body.order.token}?new=1`;
        // Card orders go straight to payment; if the shopper closes it, the order page offers it again.
        if (body.payment && (await pay(slug, body.order.token, body.payment)).kind === "redirecting") return;
        window.location.assign(orderPage);
        return;
      }
      if (body.errors) setFieldErrors(Object.fromEntries(body.errors.map((er) => [er.field, er.message])));
      setProblems(body.problems ?? (body.errors ? [] : [{ message: body.title ?? t("checkout.failed") }]));
    } catch {
      setProblems([{ message: t("checkout.offline") }]);
    }
    setBusy(false);
  }

  const err = (field: string) => fieldErrors[field];
  const input = (id: string, field: string, value: string, onChange: (v: string) => void, extra: Record<string, unknown> = {}) => (
    <input id={id} className="c-input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={err(field) ? true : undefined} aria-describedby={err(field) ? `${id}-err` : undefined} {...extra} />
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="sf-page-head">
        <h1>{t("checkout.title")}</h1>
      </div>
      <div className="sf-two">
        <div className="sf-steps">
          {problems.length > 0 && (
            <div className="c-card" role="alert" style={{ borderColor: "var(--we-color-danger)" }}>
              <strong>{t("checkout.problems")}</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {problems.map((p, i) => (
                  <li key={i}>{p.item !== undefined && cart.lines[p.item] ? `${cart.lines[p.item]!.title}: ${p.message}` : p.message}</li>
                ))}
              </ul>
              <a href={`/s/${slug}/cart`} style={{ display: "inline-block", marginTop: 8 }}>
                {t("checkout.reviewCart")}
              </a>
            </div>
          )}

          <section className="sf-step" aria-labelledby="step-contact">
            <h2 id="step-contact">
              <span>1</span> {t("checkout.details")}
            </h2>
            <div className="c-form-row">
              <Field label={t("checkout.name")} id={ids.name} error={err("name")}>
                {input(ids.name, "name", contact.name, (name) => setContact({ ...contact, name }), { autoComplete: "name", required: true, maxLength: 200 })}
              </Field>
              <Field label={t("checkout.phone")} id={ids.phone} error={err("phone")}>
                {input(ids.phone, "phone", contact.phone, (phone) => setContact({ ...contact, phone }), { autoComplete: "tel", type: "tel", maxLength: 30 })}
              </Field>
            </div>
            <Field label={t("checkout.email")} id={ids.email} error={err("email")}>
              {input(ids.email, "email", contact.email, (email) => setContact({ ...contact, email }), { autoComplete: "email", type: "email", required: true, maxLength: 254, onBlur: () => void saveCheckout() })}
            </Field>
          </section>

          <section className="sf-step" aria-labelledby="step-delivery">
            <h2 id="step-delivery">
              <span>2</span> {options[0] === "none" ? t("checkout.delivery") : t("checkout.how")}
            </h2>
            {options.length === 0 && quote ? (
              <p className="c-error">{t("checkout.noDelivery")}</p>
            ) : options[0] === "none" ? (
              <p className="c-muted" style={{ margin: 0 }}>
                {t("checkout.nothingToShip")}
              </p>
            ) : (
              <div className="c-radio-row">
                {options.map((m) => {
                  const q = quote?.totals[m];
                  return (
                    <label key={m} className="sf-choice">
                      <input type="radio" name="delivery" checked={delivery === m} onChange={() => setDelivery(m)} />
                      <span>
                        <strong>{m === "delivery" ? t("checkout.deliver") : t("checkout.pickup")}</strong>
                        <small>{m === "delivery" ? t("checkout.toAddress") : (checkout.pickup?.address ?? t("checkout.fromShop"))}</small>
                      </span>
                      <span className="sf-choice-end">{m === "pickup" || q?.deliveryMinor === 0 ? t("cart.free") : q ? money(q.deliveryMinor) : ""}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {delivery === "delivery" && (
              <div className="c-form">
                <Field label={t("checkout.address")} id={ids.line1} error={err("address.line1") ?? err("address")}>
                  {input(ids.line1, "address.line1", address.line1, (line1) => setAddress({ ...address, line1 }), { autoComplete: "address-line1", maxLength: 200 })}
                </Field>
                <Field label={t("checkout.line2")} id={ids.line2}>
                  {input(ids.line2, "address.line2", address.line2, (line2) => setAddress({ ...address, line2 }), { autoComplete: "address-line2", maxLength: 200 })}
                </Field>
                <div className="c-form-row">
                  <Field label={t("checkout.city")} id={ids.city} error={err("address.city")}>
                    {input(ids.city, "address.city", address.city, (city) => setAddress({ ...address, city }), { autoComplete: "address-level2", maxLength: 100 })}
                  </Field>
                  <Field label={t("checkout.state")} id={ids.state}>
                    {input(ids.state, "address.state", address.state, (state) => setAddress({ ...address, state }), { autoComplete: "address-level1", maxLength: 100 })}
                  </Field>
                  <Field label={t("checkout.pin")} id={ids.pin} error={err("address.postalCode")}>
                    {input(ids.pin, "address.postalCode", address.postalCode, (postalCode) => setAddress({ ...address, postalCode }), { autoComplete: "postal-code", inputMode: "numeric", maxLength: 12 })}
                  </Field>
                </div>
                {awaitingAddress && <p className="c-hint">{t("checkout.enterPin")}</p>}
                {undeliverable && (
                  <p className="c-error" role="alert">
                    {t("checkout.noZone", { store: storeName })}
                  </p>
                )}
                {pricing && pricing.shippingOptions.length > 1 && (
                  <fieldset className="sf-rates">
                    <legend className="c-label">{t("checkout.speed")}</legend>
                    <div className="c-radio-row">
                      {pricing.shippingOptions.map((o) => (
                        <label key={o.id} className="sf-choice">
                          <input type="radio" name="rate" checked={pricing.shippingRateId === o.id} onChange={() => setRateId(o.id)} />
                          <span>
                            <strong>{o.name}</strong>
                            {o.deliveryTime && <small>{o.deliveryTime}</small>}
                          </span>
                          <span className="sf-choice-end">{o.priceMinor === 0 ? t("cart.free") : money(o.priceMinor)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            )}
          </section>

          <section className="sf-step" aria-labelledby="step-payment">
            <h2 id="step-payment">
              <span>3</span> {t("checkout.payment")}
            </h2>
            {methods.length === 0 ? (
              <p className="c-error">{t("checkout.closed")}</p>
            ) : (
              <div className="c-radio-row">
                {methods.map((m) => (
                  <label key={m} className="sf-choice">
                    <input type="radio" name="payment" checked={payment === m} onChange={() => setPayment(m)} />
                    <span>
                      <strong>{copy(m).title}</strong>
                      <small>{copy(m).text}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {checkout.orderNoteEnabled && (
              <Field label={t("checkout.note")} id={ids.note} error={err("note")}>
                <textarea id={ids.note} className="c-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("checkout.notePlaceholder")} />
              </Field>
            )}
          </section>
        </div>

        <aside className="sf-summary" aria-label={t("checkout.summary")}>
          <h2>{t("checkout.summary")}</h2>
          {cart.lines.map((l) => {
            const fresh = quote?.lines.find((q) => q.variantId === l.variantId && (q.bookingAt ?? null) === l.bookingAt);
            return (
              <div key={`${l.variantId}${l.bookingAt ?? ""}`} className="sf-mini-line">
                <span className="sf-line-img">
                  <ProductImage id={l.imageId} alt="" />
                  <span className="sf-mini-qty">{l.quantity}</span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontWeight: 600 }}>{l.title}</strong>
                  <span className="sf-line-sub">{l.variantTitle}</span>
                  {fresh?.problem && <span className="c-error" style={{ display: "block" }}>{fresh.problem}</span>}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money((fresh?.priceMinor ?? l.priceMinor) * l.quantity)}</span>
              </div>
            );
          })}
          <div className="sf-code">
            <label className="c-visually-hidden" htmlFor={ids.code}>
              {t("checkout.code")}
            </label>
            <input
              id={ids.code}
              className="c-input"
              placeholder={t("checkout.code")}
              value={codeInput}
              maxLength={32}
              autoCapitalize="characters"
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setDiscountCode(codeInput.trim() || null);
                }
              }}
            />
            <button type="button" className="sf-btn sf-btn-sm" disabled={!codeInput.trim()} onClick={() => setDiscountCode(codeInput.trim() || null)}>
              {t("checkout.apply")}
            </button>
          </div>
          {discountCode && sums?.discountError && (
            <p className="c-error" role="alert" style={{ margin: 0 }}>
              {sums.discountError}
            </p>
          )}
          <div className="sf-sum-row">
            <span>{t("cart.subtotal")}</span>
            <span>{sums ? money(sums.subtotalMinor) : "…"}</span>
          </div>
          {sums?.discount && (
            <div className="sf-sum-row sf-sum-save">
              <span>
                {sums.discount.code ?? sums.discount.title}
                {sums.discount.code && discountCode && (
                  <button
                    type="button"
                    className="sf-link"
                    onClick={() => {
                      setDiscountCode(null);
                      setCodeInput("");
                    }}
                  >
                    {t("checkout.remove")}
                  </button>
                )}
              </span>
              <span>{sums.discount.type === "free_shipping" ? t("cart.freeDelivery") : `−${money(sums.discountMinor)}`}</span>
            </div>
          )}
          {delivery === "delivery" && (
            <div className="sf-sum-row">
              <span>{t("cart.delivery")}</span>
              <span>{!sums ? "…" : awaitingAddress ? t("checkout.pinNeeded") : sums.deliveryMinor === 0 ? t("cart.free") : money(sums.deliveryMinor)}</span>
            </div>
          )}
          {sums && sums.taxLabel && !sums.pricesIncludeTax && (
            <div className="sf-sum-row">
              <span>{sums.taxLabel}</span>
              <span>{money(sums.taxMinor)}</span>
            </div>
          )}
          <div className="sf-sum-row sf-sum-total">
            <span>{t("cart.total")}</span>
            <span>{sums ? money(sums.totalMinor) : "…"}</span>
          </div>
          {sums && sums.taxLabel && sums.pricesIncludeTax && sums.taxMinor > 0 && (
            <p className="c-hint" style={{ margin: 0, textAlign: "end" }}>
              {t("checkout.includes", { amount: money(sums.taxMinor), tax: sums.taxLabel })}
            </p>
          )}
          <button
            type="submit"
            className={`sf-btn sf-btn-block ${payment === "whatsapp" ? "sf-btn-wa" : payment === "telegram" ? "sf-btn-tg" : "sf-btn-brand"}`}
            disabled={busy || !delivery || !payment || !quote || undeliverable}
          >
            {busy
              ? t("checkout.placing")
              : payment === "whatsapp"
                ? t("checkout.toWhatsapp")
                : payment === "telegram"
                  ? t("checkout.toTelegram")
                  : payment === "card"
                    ? t("checkout.pay", { amount: sums ? money(sums.totalMinor) : "" }).trim()
                    : t("checkout.place")}
          </button>
          <p className="c-hint" style={{ textAlign: "center" }}>
            {t("checkout.goesTo", { store: storeName })}
          </p>
        </aside>
      </div>
    </form>
  );
}
