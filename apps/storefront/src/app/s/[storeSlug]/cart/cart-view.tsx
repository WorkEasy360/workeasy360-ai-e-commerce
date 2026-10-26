"use client";

import { formatMoney } from "@workeasy/commerce";
import { CartIcon } from "@workeasy/ui/react";
import { useI18n } from "../../../../components/i18n";
import { ProductImage } from "../../../../components/shop";
import { useCart } from "../../../../lib/cart";
import { useQuote } from "../../../../lib/quote";

/** The cart, priced by the shop: change quantities, remove lines, see delivery and totals. */
export function CartView({ slug, currency, locale }: { slug: string; currency: string; locale: string }) {
  const cart = useCart(slug);
  const { quote, error } = useQuote(slug, cart.lines);
  const { t } = useI18n();
  const money = (m: number) => formatMoney(m, currency, locale);

  if (cart.lines.length === 0) {
    return (
      <div className="sf-empty">
        <CartIcon size={34} />
        <h2>{t("cart.empty")}</h2>
        <p>{t("cart.emptyText")}</p>
        <a className="sf-btn sf-btn-brand" href={`/s/${slug}/products`}>
          {t("cart.start")}
        </a>
      </div>
    );
  }

  const blocked = quote?.lines.some((l) => l.problem) ?? true;
  const best = quote ? (quote.totals.delivery ?? quote.totals.pickup ?? quote.totals.none) : undefined;
  const delivery = quote?.checkout.delivery;

  return (
    <>
      <div className="sf-page-head">
        <h1>{t("cart.title")}</h1>
      </div>
      <div className="sf-two">
        <div className="sf-lines">
          {cart.lines.map((line) => {
            const fresh = quote?.lines.find((q) => q.variantId === line.variantId && (q.bookingAt ?? null) === line.bookingAt);
            const price = fresh?.priceMinor ?? line.priceMinor;
            const max = Math.min(99, fresh?.maxQuantity ?? 99);
            return (
              <div key={`${line.variantId}${line.bookingAt ?? ""}`} className="sf-line">
                <a className="sf-line-img" href={`/s/${slug}/p/${line.handle}`} tabIndex={-1} aria-hidden="true">
                  <ProductImage id={fresh?.imageId ?? line.imageId} alt="" />
                </a>
                <div style={{ minWidth: 0 }}>
                  <a className="sf-line-title" href={`/s/${slug}/p/${line.handle}`}>
                    {fresh?.title ?? line.title}
                  </a>
                  <div className="sf-line-sub">
                    {[line.variantTitle, line.bookingAt ? new Date(line.bookingAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : null, money(price)].filter(Boolean).join(" · ")}
                  </div>
                  {fresh?.problem && (
                    <p className="c-error" role="alert" style={{ marginTop: 6 }}>
                      {fresh.problem}
                    </p>
                  )}
                  <div className="sf-line-actions">
                    <div className="sf-qty" role="group" aria-label={t("cart.quantityOf", { title: line.title })}>
                      <button type="button" aria-label={t("product.fewer")} onClick={() => cart.setQuantity(line, line.quantity - 1)}>
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button type="button" aria-label={t("product.more")} disabled={line.quantity >= max} onClick={() => cart.setQuantity(line, line.quantity + 1)}>
                        +
                      </button>
                    </div>
                    <button type="button" className="sf-link-btn" onClick={() => cart.remove(line)}>
                      {t("cart.remove")}
                    </button>
                  </div>
                </div>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{money(price * line.quantity)}</strong>
              </div>
            );
          })}
        </div>

        <aside className="sf-summary" aria-label={t("checkout.summary")}>
          <h2>{t("cart.summary")}</h2>
          {error && (
            <p className="c-error" role="alert">
              {t("cart.offline")}
            </p>
          )}
          <div className="sf-sum-row">
            <span>{t("cart.subtotal")}</span>
            <span>{best ? money(best.subtotalMinor) : "…"}</span>
          </div>
          {quote?.pricing?.discount && (
            <div className="sf-sum-row sf-sum-save">
              <span>{quote.pricing.discount.title}</span>
              <span>{quote.pricing.discount.type === "free_shipping" ? t("cart.freeDelivery") : `−${money(quote.pricing.discountMinor)}`}</span>
            </div>
          )}
          {quote?.deliveryOptions.includes("delivery") && delivery && (
            <div className="sf-sum-row">
              <span>{t("cart.delivery")}</span>
              <span>{quote.pricing?.shippingNeedsAddress ? t("cart.atCheckout") : best?.deliveryMinor === 0 ? t("cart.free") : best ? money(best.deliveryMinor) : "…"}</span>
            </div>
          )}
          {delivery?.freeOverMinor != null && best && best.deliveryMinor > 0 && !quote?.pricing?.shippingNeedsAddress && (
            <p className="c-hint" style={{ fontSize: 13.5 }}>
              {t("cart.addMore", { amount: money(delivery.freeOverMinor - best.subtotalMinor) })}
            </p>
          )}
          <div className="sf-sum-row sf-sum-total">
            <span>{t("cart.total")}</span>
            <span>{best ? money(best.totalMinor) : "…"}</span>
          </div>
          <a className="sf-btn sf-btn-brand sf-btn-block" href={blocked ? undefined : `/s/${slug}/checkout`} aria-disabled={blocked} style={blocked ? { opacity: 0.55, pointerEvents: "none" } : undefined}>
            {t("cart.checkout")}
          </a>
          {quote && blocked && <p className="c-hint">{t("cart.fixItems")}</p>}
          <a href={`/s/${slug}/products`} style={{ textAlign: "center", fontSize: 14 }}>
            {t("cart.continue")}
          </a>
        </aside>
      </div>
    </>
  );
}
