import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@workeasy/commerce";
import { CheckIcon, DownloadIcon } from "@workeasy/ui/react";
import { ProductImage } from "../../../../../components/shop";
import type { MessageKey } from "../../../../../lib/i18n";
import { currentShop, shopI18n } from "../../../../../lib/shop-context";
import { getOrder } from "../../../../../lib/stores";
import { ChatButton } from "./chat-button";
import { ReviewForms } from "../../../../../components/reviews";
import { PayButton } from "./pay-button";

type Props = { params: Promise<{ storeSlug: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };


/**
 * The shopper's order page, reached from the link after checkout and in the
 * receipt email. The link is the key, so the page is never indexed and
 * never sends itself as a referrer.
 */
export default async function OrderPage({ params, searchParams }: Props) {
  const { storeSlug, token } = await params;
  const query = await searchParams;
  const isNew = query.new === "1";
  const [shop, found] = await Promise.all([currentShop(storeSlug), getOrder(storeSlug, token, query.paid === "stripe" ? "stripe" : undefined)]);
  if (!shop || !found) notFound();
  const { order } = found;
  const { t, tn, locale } = await shopI18n(shop);
  const method = t(`method.${order.paymentMethod}` as MessageKey);
  const money = (m: number) => formatMoney(m, order.currency, locale);
  const chatPending = order.chat !== null && order.paymentStatus === "pending";
  const cardPending = order.paymentMethod === "card" && order.paymentStatus === "pending" && order.status === "open";
  const shipped = order.shipments.length > 0;

  const status =
    order.status === "cancelled"
      ? {
          title: t("order.cancelled"),
          text: order.paymentMethod === "card" && order.paymentStatus === "pending" ? t("order.cancelledUnpaid") : t("order.cancelledText"),
        }
      : order.fulfillmentStatus === "fulfilled"
        ? { title: t("order.onItsWay"), text: shipped ? t("order.track") : t("order.fulfilledText") }
        : order.fulfillmentStatus === "partially_fulfilled"
          ? { title: t("order.partOnWay"), text: t("order.restSoon") }
          : order.paymentStatus !== "pending"
          ? { title: t("order.paid"), text: t("order.paidText") }
          : cardPending
            ? { title: query.paid === "stripe" ? t("order.confirming") : t("order.almost"), text: query.paid === "stripe" ? t("order.confirmingText") : t("order.almostText") }
          : chatPending
            ? { title: t("order.lastStep"), text: t("order.lastStepText", { store: shop.store.name }) }
            : { title: isNew ? t("order.thanks") : t("order.received"), text: t("order.receipt", { email: order.email }) };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="sf-thanks">
        <span className="sf-check" aria-hidden="true">
          <CheckIcon size={30} />
        </span>
        <span className="c-badge">{t("order.number", { number: order.number })}</span>
        <h1>{status.title}</h1>
        <p>{status.text}</p>
      </div>

      {order.chat && order.paymentStatus === "pending" && order.status === "open" && <ChatButton chat={order.chat} storeName={shop.store.name} />}

      {cardPending && query.paid !== "stripe" && <PayButton slug={shop.store.slug} token={token} amount={money(order.totalMinor)} payBy={order.payBy} provider={shop.checkout.card?.provider ?? null} />}

      {order.downloads.length > 0 && (
        <section className="sf-step" aria-labelledby="dl-h">
          <h2 id="dl-h">{t("order.downloads")}</h2>
          <ul className="sf-downloads">
            {order.downloads.map((d) => (
              <li key={d.id}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{d.fileName}</strong>
                  <span className="sf-line-sub" style={{ display: "block" }}>
                    {!d.usable
                      ? t("order.unavailable")
                      : [
                          d.downloadsLeft === null ? null : tn("order.downloadsLeft", d.downloadsLeft),
                          d.expiresAt ? t("order.until", { date: new Date(d.expiresAt).toLocaleDateString(locale, { dateStyle: "medium" }) }) : null,
                        ]
                          .filter(Boolean)
                          .join(", ") || t("order.anyTime")}
                  </span>
                </span>
                {d.usable && (
                  <a className="sf-btn sf-btn-sm" href={d.url} rel="nofollow">
                    <DownloadIcon size={15} /> {t("order.download")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {order.downloads.length === 0 && order.items.some((i) => i.productType === "digital") && order.status === "open" && order.paymentStatus === "pending" && (
        <p className="c-hint" style={{ textAlign: "center", margin: 0 }}>
          {t("order.downloadsSoon")}
        </p>
      )}

      {shipped && (
        <section className="sf-step" aria-labelledby="ship-h">
          <h2 id="ship-h">{t("order.tracking")}</h2>
          <ul className="sf-shipments">
            {order.shipments.map((s, n) => (
              <li key={n}>
                <span>
                  <strong>{s.carrier ?? t("order.shipment")}</strong>
                  <span className="sf-line-sub" style={{ display: "block" }}>
                    {[s.trackingNumber, tn("order.items", s.units), new Date(s.at).toLocaleDateString(locale, { dateStyle: "medium" })].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {s.trackingUrl && (
                  <a className="sf-btn sf-btn-sm" href={s.trackingUrl} target="_blank" rel="noreferrer noopener">
                    {t("order.trackParcel")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.paymentInstructions && (
        <section className="sf-step" aria-labelledby="pay-h">
          <h2 id="pay-h">{t("order.howToPay", { method })}</h2>
          <div className="sf-instructions">{order.paymentInstructions}</div>
          {order.paymentMethod !== "cod" && <p className="c-hint">{t("order.mention", { number: order.number })}</p>}
        </section>
      )}

      <section className="sf-step" aria-labelledby="items-h">
        <h2 id="items-h">{t("order.yourOrder")}</h2>
        <div className="sf-lines">
          {order.items.map((i, n) => (
            <div key={n} className="sf-line" style={{ gridTemplateColumns: "60px minmax(0,1fr) auto" }}>
              <span className="sf-line-img" style={{ width: 60, height: 60 }}>
                <ProductImage id={i.imageId} alt="" />
              </span>
              <span>
                <strong>{i.title}</strong>
                <span className="sf-line-sub" style={{ display: "block" }}>
                  {[i.variantTitle, i.bookingLabel, `${i.quantity} × ${money(i.unitPriceMinor)}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{money(i.totalMinor)}</strong>
            </div>
          ))}
        </div>
        <div className="sf-sum-row">
          <span>{t("cart.subtotal")}</span>
          <span>{money(order.subtotalMinor)}</span>
        </div>
        {order.discountMinor > 0 && (
          <div className="sf-sum-row sf-sum-save">
            <span>
              {t("order.discount")}
              {order.discountLabel ? ` (${order.discountLabel})` : ""}
            </span>
            <span>−{money(order.discountMinor)}</span>
          </div>
        )}
        {order.deliveryMethod === "delivery" && (
          <div className="sf-sum-row">
            <span>
              {t("cart.delivery")}
              {order.shippingRateName ? ` · ${order.shippingRateName}` : ""}
            </span>
            <span>{order.deliveryMinor === 0 ? t("cart.free") : money(order.deliveryMinor)}</span>
          </div>
        )}
        {order.taxLabel && !order.pricesIncludeTax && (
          <div className="sf-sum-row">
            <span>{order.taxLabel}</span>
            <span>{money(order.taxMinor)}</span>
          </div>
        )}
        <div className="sf-sum-row sf-sum-total">
          <span>{t("cart.total")}</span>
          <span>{money(order.totalMinor)}</span>
        </div>
        {order.taxLabel && order.pricesIncludeTax && order.taxMinor > 0 && (
          <p className="c-hint" style={{ margin: 0, textAlign: "end" }}>
            {t("checkout.includes", { amount: money(order.taxMinor), tax: order.taxLabel })}
          </p>
        )}
        {order.refundedMinor > 0 && (
          <div className="sf-sum-row">
            <span>{t("order.refunded")}</span>
            <span>−{money(order.refundedMinor)}</span>
          </div>
        )}
      </section>

      {found.reviews && found.reviews.length > 0 && order.status === "open" && (
        <ReviewForms items={found.reviews} postUrl={`/public/v1/stores/${shop.store.slug}/orders/${token}/reviews`} heading={found.reviews.every((i) => i.review) ? t("reviews.yours") : t("reviews.rateItems")} />
      )}

      <section className="sf-step" aria-labelledby="details-h">
        <h2 id="details-h">{t("order.details")}</h2>
        <dl className="c-kv">
          <dt>{t("order.placed")}</dt>
          <dd>{new Date(order.placedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</dd>
          <dt>{t("order.payment")}</dt>
          <dd>
            {method} · {t(`status.${order.paymentStatus}` as MessageKey)}
          </dd>
          <dt>{order.deliveryMethod === "pickup" ? t("order.pickupFrom") : order.deliveryMethod === "delivery" ? t("order.deliverTo") : t("order.deliveryLabel")}</dt>
          <dd>
            {order.deliveryMethod === "delivery" && order.address
              ? `${order.name}, ${[order.address.line1, order.address.line2, order.address.city, order.address.state, order.address.postalCode].filter(Boolean).join(", ")}`
              : order.deliveryMethod === "pickup"
                ? (order.pickupAddress ?? t("order.theShop"))
                : t("order.nothingToShip")}
          </dd>
          {order.note && (
            <>
              <dt>{t("order.note")}</dt>
              <dd>{order.note}</dd>
            </>
          )}
          {found.contactEmail && (
            <>
              <dt>{t("order.questions")}</dt>
              <dd>
                <a href={`mailto:${found.contactEmail}?subject=${encodeURIComponent(`Order #${order.number}`)}`}>{found.contactEmail}</a>
              </dd>
            </>
          )}
        </dl>
      </section>

      <p style={{ textAlign: "center" }}>
        <a href={`/s/${shop.store.slug}`}>{t("cart.continue")}</a>
      </p>
    </div>
  );
}
