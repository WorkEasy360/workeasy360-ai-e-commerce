import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentShop, shopI18n } from "../../../../lib/shop-context";
import { CheckoutForm } from "./checkout-form";

type Props = { params: Promise<{ storeSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) return { title: "Store not found", robots: { index: false } };
  const { t } = await shopI18n(shop);
  return { title: `${t("checkout.metaTitle")} · ${shop.store.name}`, robots: { index: false } };
}

export default async function CheckoutPage({ params }: Props) {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) notFound();
  const { locale } = await shopI18n(shop);
  return <CheckoutForm slug={shop.store.slug} storeName={shop.store.name} currency={shop.store.currency} country={shop.store.country} locale={locale} checkout={shop.checkout} />;
}
