import { formatMoney, formatPriceRange } from "@workeasy/commerce";
import { BrandMark, ProductIcon } from "@workeasy/ui/react";
import { mediaUrl, type ProductCard } from "../lib/stores";

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

export function ProductImage({ id, alt }: { id: string | null; alt: string }) {
  if (!id) {
    return (
      <span className="sf-placeholder" aria-hidden="true">
        <ProductIcon size={34} />
      </span>
    );
  }
  return <img src={mediaUrl(id)} alt={alt} loading="lazy" />;
}

export interface GridLabels {
  soldOut: string;
  sale: string;
  was: string;
}

export function ProductGrid({ products, slug, currency, locale, labels }: { products: ProductCard[]; slug: string; currency: string; locale: string; labels: GridLabels }) {
  return (
    <div className="sf-grid">
      {products.map((p) => (
        <a key={p.id} className="sf-card" href={`/s/${slug}/p/${p.handle}`}>
          <span className="sf-card-img">
            <ProductImage id={p.imageId} alt={p.imageAlt} />
            {!p.available ? (
              <span className="c-badge">{labels.soldOut}</span>
            ) : p.compareAtMinor ? (
              <span className="c-badge" data-tone="brand">
                {labels.sale}
              </span>
            ) : null}
          </span>
          <span className="sf-card-title">{p.title}</span>
          <Price min={p.priceMin} max={p.priceMax} compareAt={p.compareAtMinor} currency={currency} locale={locale} wasLabel={labels.was} />
        </a>
      ))}
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
          <BrandMark size={18} idPrefix="footer-mark" /> {labels.powered}
        </span>
      </div>
    </footer>
  );
}

/** Product card labels in the shopper's language. */
export function gridLabels(t: (key: "card.soldOut" | "card.sale" | "price.was") => string): GridLabels {
  return { soldOut: t("card.soldOut"), sale: t("card.sale"), was: t("price.was") };
}

/** The locale for formatting money and dates: the shop's language, in its country. */
export function shopLocale(store: { defaultLocale: string; country: string }): string {
  return store.defaultLocale.includes("-") ? store.defaultLocale : `${store.defaultLocale}-${store.country}`;
}
