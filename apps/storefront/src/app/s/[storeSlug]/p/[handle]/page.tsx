import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toDecimalString } from "@workeasy/commerce";
import { currentShop, shopI18n } from "../../../../../lib/shop-context";
import { StarsShown } from "../../../../../components/reviews";
import { getProduct, getReviews, mediaUrl } from "../../../../../lib/stores";
import { ProductBuy } from "./product-buy";

type Props = { params: Promise<{ storeSlug: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storeSlug, handle } = await params;
  const [shop, product] = await Promise.all([currentShop(storeSlug), getProduct(storeSlug, handle)]);
  if (!shop || !product) return { title: "Not found" };
  const image = product.media.find((m) => m.kind === "image");
  return {
    title: `${product.seoTitle ?? product.title} · ${shop.store.name}`,
    description: product.seoDescription ?? (product.description.slice(0, 160) || undefined),
    openGraph: { title: product.title, type: "website", ...(image ? { images: [mediaUrl(image.id)] } : {}) },
  };
}

/** A product page: gallery, choices, add to cart, and structured data for search engines. */
export default async function ProductPage({ params }: Props) {
  const { storeSlug, handle } = await params;
  const [shop, product, reviews] = await Promise.all([currentShop(storeSlug), getProduct(storeSlug, handle), getReviews(storeSlug, handle)]);
  if (!shop || !product) notFound();
  const { store } = shop;
  const rating = reviews?.summary;
  const { t, tn, locale } = await shopI18n(shop);
  const cheapest = product.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), product.variants[0]!);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description || undefined,
    brand: product.vendor ? { "@type": "Brand", name: product.vendor } : undefined,
    ...(rating && rating.count > 0 && rating.average !== null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.average, reviewCount: rating.count } } : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: store.currency,
      price: toDecimalString(cheapest.priceMinor, store.currency),
      availability: product.variants.some((v) => v.available) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ProductBuy slug={store.slug} product={product} currency={store.currency} locale={locale} />
      {reviews && reviews.summary.count > 0 && (
        <section className="sf-reviews" aria-labelledby="reviews-h">
          <div className="sf-reviews-head">
            <h2 id="reviews-h">{t("reviews.title")}</h2>
            <span>
              <StarsShown rating={reviews.summary.average ?? 0} size={18} /> <strong>{reviews.summary.average?.toFixed(1)}</strong>{" "}
              <span className="c-muted">{tn("reviews.from", reviews.summary.count)}</span>
            </span>
          </div>
          <ul>
            {reviews.reviews.map((r) => (
              <li key={r.id}>
                <StarsShown rating={r.rating} size={14} />
                {r.title && <strong>{r.title}</strong>}
                {r.body && <p>{r.body}</p>}
                <span className="sf-line-sub">
                  {r.author} · {t("reviews.verified")} · {new Date(r.createdAt).toLocaleDateString(locale, { dateStyle: "medium" })}
                </span>
                {r.reply && (
                  <blockquote>
                    <strong>{store.name}:</strong> {r.reply}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
