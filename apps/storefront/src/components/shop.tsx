import { formatMoney, formatPriceRange } from "@workeasy/commerce";
import { BrandMark, ProductIcon } from "@workeasy/ui/react";
import type { MessageKey } from "../lib/i18n";
import { mediaUrl, type ProductCard } from "../lib/stores";
import { QuickAdd } from "./quick-add";

/** Price with the struck-through compare-at price when it shows a saving. */
export function Price({ min, max, compareAt, currency, locale, wasLabel = "Was " }: { min: number; max?: number; compareAt?: number | null; currency: string; locale: string; wasLabel?: string }) {
  return (
    <span className="sf-price">
      <span>{formatPriceRange(min, max ?? min, currency, locale)}</span>
      {compareAt != null && compareAt > min && (
        <s>
          <span className="c-visually-hidden">{wasLabel}</span>
          {formatMoney(compareAt, currency, locale, { compact: true })}
        </s>
      )}
    </span>
  );
}

/** Up to two initials from a product title ("Masala Chai 250 g" → "MC"). */
function initials(title: string): string {
  const words = title.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0]!.toLocaleUpperCase()).join("");
}

/** One of four soft tones, chosen from the title so a product always looks the same. */
function tone(title: string): number {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

/**
 * A product's photo, or a placeholder when it has none: the title's
 * initials on one of four soft tones, so a catalogue without photos still
 * looks deliberate.
 */
export function ProductImage({ id, alt, title }: { id: string | null; alt: string; title?: string }) {
  if (!id) {
    const letters = title ? initials(title) : "";
    return (
      <span className="sf-placeholder" data-tone={title ? tone(title) : undefined} aria-hidden="true">
        {letters ? <span className="sf-initials">{letters}</span> : <ProductIcon size={28} />}
      </span>
    );
  }
  return <img src={mediaUrl(id)} alt={alt} loading="lazy" />;
}

export interface GridLabels {
  soldOut: string;
  sale: string;
  was: string;
  add: string;
  added: string;
  options: string;
  /** "{n}% OFF" with the number filled in. */
  off: (n: number) => string;
}

/**
 * Product cards as in the Commerce designs: photo with the saving as a
 * badge, title, price with the old price struck through, and Add to Cart
 * for products with a single option in stock (others open the product).
 */
export function ProductGrid({ products, slug, currency, locale, labels }: { products: ProductCard[]; slug: string; currency: string; locale: string; labels: GridLabels }) {
  return (
    <div className="sf-grid">
      {products.map((p) => {
        const href = `/s/${slug}/p/${p.handle}`;
        const off = p.compareAtMinor ? Math.round((1 - p.priceMin / p.compareAtMinor) * 100) : 0;
        return (
          <div key={p.id} className="sf-card">
            <a className="sf-card-img" href={href} tabIndex={-1} aria-hidden="true">
              <ProductImage id={p.imageId} alt="" title={p.title} />
              {!p.available ? <span className="c-badge">{labels.soldOut}</span> : off > 0 ? <span className="sf-sale">{labels.off(off)}</span> : null}
            </a>
            <span className="sf-card-body">
              <a className="sf-card-title" href={href}>
                {p.title}
              </a>
              <span className="sf-card-price">
                <Price min={p.priceMin} max={p.priceMax} compareAt={p.compareAtMinor} currency={currency} locale={locale} wasLabel={labels.was} />
                {off > 0 && <span className="sf-card-off">({labels.off(off)})</span>}
              </span>
            </span>
            {p.quickAddVariantId ? (
              <QuickAdd slug={slug} item={{ variantId: p.quickAddVariantId, title: p.title, handle: p.handle, imageId: p.imageId, priceMinor: p.priceMin }} labels={{ add: labels.add, added: labels.added }} />
            ) : (
              <a className="sf-btn sf-btn-block sf-btn-ghost sf-card-add" href={href}>
                {p.available ? labels.options : labels.soldOut}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ShopFooter({
  name,
  text = "",
  links = [],
  labels,
}: {
  name: string;
  text?: string;
  links?: Array<{ label: string; href: string }>;
  labels: { footer: string; powered: string };
}) {
  return (
    <footer className="sf-footer">
      <div className="sf-footer-brand">
        <strong>{name}</strong>
      </div>
      {(text || links.length > 0) && (
        <div className="sf-footer-row sf-footer-top">
          {text && <p>{text}</p>}
          {links.length > 0 && (
            <nav aria-label={labels.footer}>
              {links.map((l) => (
                <a key={`${l.href}${l.label}`} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          )}
        </div>
      )}
      <div className="sf-footer-row">
        <span>© {name}</span>
        <span className="sf-powered">
          <BrandMark size={18} /> {labels.powered}
        </span>
      </div>
    </footer>
  );
}

/** Product card labels in the shopper's language. */
export function gridLabels(t: (key: MessageKey, vars?: Record<string, string | number>) => string): GridLabels {
  return {
    soldOut: t("card.soldOut"),
    sale: t("card.sale"),
    was: t("price.was"),
    add: t("product.add"),
    added: t("card.added"),
    options: t("card.options"),
    off: (n) => t("card.off", { n }),
  };
}

/** The locale for formatting money and dates: the shop's language, in its country. */
export function shopLocale(store: { defaultLocale: string; country: string }): string {
  return store.defaultLocale.includes("-") ? store.defaultLocale : `${store.defaultLocale}-${store.country}`;
}
