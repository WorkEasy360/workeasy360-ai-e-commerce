"use client";

import { useEffect, useId, useState } from "react";
import { CalendarIcon, CheckIcon, DownloadIcon, ShippingIcon } from "@workeasy/ui/react";
import { Price, ProductImage } from "../../../../../components/shop";
import { useCart } from "../../../../../lib/cart";
import { mediaUrl, type ShopProduct } from "../../../../../lib/stores";
import { useI18n } from "../../../../../components/i18n";
import { track } from "../../../../../lib/track";
import { SlotPicker } from "./slot-picker";

/**
 * The interactive half of a product page: gallery, option choices that
 * narrow to one variant, quantity, booking time for services, and add to
 * cart. Unavailable combinations stay visible but can't be added.
 */
export function ProductBuy({ slug, product, currency, locale }: { slug: string; product: ShopProduct; currency: string; locale: string }) {
  const ids = { qty: useId() };
  const { t } = useI18n();
  const cart = useCart(slug);
  const firstAvailable = product.variants.find((v) => v.available) ?? product.variants[0]!;
  const [choice, setChoice] = useState<string[]>(firstAvailable.options);
  const [quantity, setQuantity] = useState(1);
  const [shown, setShown] = useState(0);
  const [bookingAt, setBookingAt] = useState("");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    track(slug, { type: "product_view", productId: product.id });
  }, [slug, product.id]);

  const variant = product.variants.find((v) => v.options.every((o, i) => o === choice[i]));
  const max = variant?.maxQuantity ?? 99;
  const service = product.type === "service";
  const canAdd = variant !== undefined && variant.available && (!service || bookingAt !== "");
  const media = product.media;
  const current = media[shown];

  /** Whether choosing `value` for option `index` (keeping the other choices) gives a buyable variant. */
  const buyable = (index: number, value: string) => product.variants.some((v) => v.available && v.options.every((o, i) => (i === index ? o === value : o === choice[i])));

  function add() {
    if (!variant || !canAdd) return;
    cart.add(
      {
        variantId: variant.id,
        quantity,
        bookingAt: service ? bookingAt : null,
        title: product.title,
        variantTitle: variant.options.length > 0 ? variant.options.join(" / ") : null,
        handle: product.handle,
        imageId: media.find((m) => m.kind === "image")?.id ?? null,
        priceMinor: variant.priceMinor,
      },
      variant.maxQuantity,
    );
    track(slug, { type: "add_to_cart", productId: product.id });
    setAdded(true);
    setTimeout(() => setAdded(false), 4000);
  }

  const stock =
    !variant || !variant.available
      ? { tone: "out", text: product.options.length > 0 && !variant ? t("product.choose") : t("product.soldOut") }
      : variant.maxQuantity !== null && variant.maxQuantity <= 5
        ? { tone: "low", text: t("product.onlyLeft", { n: variant.maxQuantity }) }
        : null;

  return (
    <div className="sf-product">
      <div className="sf-gallery">
        <div className="sf-gallery-main">
          {current?.kind === "video" ? <video src={mediaUrl(current.id)} controls playsInline /> : <ProductImage id={current?.id ?? null} alt={current?.alt ?? product.title} />}
        </div>
        {media.length > 1 && (
          <div className="sf-thumbs" role="group" aria-label={t("product.photos")}>
            {media.map((m, i) => (
              <button key={m.id} type="button" aria-pressed={i === shown} aria-label={t("product.showMedia", { n: i + 1 })} onClick={() => setShown(i)}>
                {m.kind === "image" ? <img src={mediaUrl(m.id)} alt="" /> : <span className="sf-placeholder">▶</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sf-buy">
        {product.vendor && <span className="sf-vendor">{product.vendor}</span>}
        <h1>{product.title}</h1>
        <Price min={variant?.priceMinor ?? firstAvailable.priceMinor} compareAt={variant?.compareAtMinor ?? null} currency={currency} locale={locale} wasLabel={t("price.was")} />

        {product.options.map((option, index) => (
          <div key={option.name} className="sf-option" role="group" aria-label={option.name}>
            <span className="sf-option-label">
              {option.name}: <span className="c-muted">{choice[index]}</span>
            </span>
            <div className="sf-chips">
              {option.values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="sf-chip"
                  aria-pressed={choice[index] === value}
                  data-unavailable={!buyable(index, value) ? "true" : undefined}
                  onClick={() => setChoice((c) => c.map((x, i) => (i === index ? value : x)))}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}

        {service && <SlotPicker slug={slug} handle={product.handle} locale={locale} value={bookingAt} onChange={setBookingAt} />}

        {stock && (
          <span className="sf-stock" data-tone={stock.tone}>
            {stock.text}
          </span>
        )}

        <div className="sf-buy-row">
          <div className="sf-qty" role="group" aria-label={t("product.quantity")}>
            <button type="button" aria-label={t("product.fewer")} disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              −
            </button>
            <span id={ids.qty} aria-live="polite">
              {quantity}
            </span>
            <button type="button" aria-label={t("product.more")} disabled={quantity >= Math.min(99, max)} onClick={() => setQuantity((q) => Math.min(99, max, q + 1))}>
              +
            </button>
          </div>
          <button type="button" className="sf-btn sf-btn-brand" disabled={!canAdd} onClick={add}>
            {service ? t("product.book") : t("product.add")}
          </button>
        </div>

        <div className="sf-facts">
          {product.type === "physical" && (
            <div>
              <ShippingIcon size={18} /> {t("product.factPhysical")}
            </div>
          )}
          {product.type === "digital" && (
            <div>
              <DownloadIcon size={18} /> {product.downloadLimit ? t("product.factDigitalLimit", { n: product.downloadLimit }) : t("product.factDigital")}
            </div>
          )}
          {service && (
            <div>
              <CalendarIcon size={18} /> {t("product.factService", { n: product.bookingDurationMinutes ?? 60 })}
            </div>
          )}
          <div>
            <CheckIcon size={18} /> {t("product.factPay")}
          </div>
        </div>

        {product.description && <div className="sf-desc">{product.description}</div>}
      </div>

      {added && (
        <div className="sf-toast" role="status">
          <span>{t("product.added")}</span>
          <a href={`/s/${slug}/cart`}>{t("product.viewCart", { n: cart.count })}</a>
        </div>
      )}
    </div>
  );
}
