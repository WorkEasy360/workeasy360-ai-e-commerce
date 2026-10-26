import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentShop, shopI18n } from "../../../../lib/shop-context";
import { CartView } from "./cart-view";

type Props = { params: Promise<{ storeSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) return { title: "Store not found", robots: { index: false } };
  const { t } = await shopI18n(shop);
  return { title: `${t("cart.metaTitle")} · ${shop.store.name}`, robots: { index: false } };
}

export default async function CartPage({ params }: Props) {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) notFound();
  const { locale } = await shopI18n(shop);
  return <CartView slug={shop.store.slug} currency={shop.store.currency} locale={locale} />;
}
