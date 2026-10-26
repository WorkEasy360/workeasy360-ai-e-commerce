import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewForms } from "../../../../../components/reviews";
import { currentShop, shopI18n } from "../../../../../lib/shop-context";
import { getReviewRequest } from "../../../../../lib/stores";

type Props = { params: Promise<{ storeSlug: string; token: string }> };

export const metadata: Metadata = { title: "Review your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The page behind the review email: the order's items, ready to rate. The link is the key. */
export default async function ReviewPage({ params }: Props) {
  const { storeSlug, token } = await params;
  const [shop, request] = await Promise.all([currentShop(storeSlug), getReviewRequest(storeSlug, token)]);
  if (!shop) notFound();
  const { t } = await shopI18n(shop);
  if (!request) {
    return (
      <div className="sf-empty">
        <h2>{t("reviews.expired")}</h2>
        <p>{t("reviews.expiredText", { store: shop.store.name })}</p>
        <a className="sf-btn sf-btn-brand" href={`/s/${shop.store.slug}`}>
          {t("reviews.visit")}
        </a>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="sf-page-head" style={{ textAlign: "center" }}>
        <h1>{t("reviews.hello", { name: request.name })}</h1>
        <p className="c-muted">{t("reviews.intro", { number: request.number, store: shop.store.name })}</p>
      </div>
      <ReviewForms items={request.items} postUrl={`/public/v1/stores/${shop.store.slug}/review-requests/${token}/reviews`} heading={t("reviews.rate")} />
    </div>
  );
}
