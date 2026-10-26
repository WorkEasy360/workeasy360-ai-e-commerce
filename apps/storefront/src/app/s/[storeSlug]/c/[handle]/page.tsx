import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { gridLabels, ProductGrid } from "../../../../../components/shop";
import { currentShop, shopI18n } from "../../../../../lib/shop-context";
import { getCollection, parseSort, SORTS } from "../../../../../lib/stores";

type Props = { params: Promise<{ storeSlug: string; handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storeSlug, handle } = await params;
  const [shop, found] = await Promise.all([currentShop(storeSlug), getCollection(storeSlug, handle)]);
  if (!shop || !found) return { title: "Not found" };
  return { title: `${found.collection.seoTitle ?? found.collection.title} · ${shop.store.name}`, description: found.collection.seoDescription ?? (found.collection.description || undefined) };
}

/** One collection's products, in the collection's order or the shopper's chosen sort. */
export default async function CollectionPage({ params, searchParams }: Props) {
  const { storeSlug, handle } = await params;
  const sort = parseSort((await searchParams).sort);
  const [shop, found] = await Promise.all([currentShop(storeSlug), getCollection(storeSlug, handle, sort)]);
  if (!shop || !found) notFound();
  const { store } = shop;
  const { t, locale } = await shopI18n(shop);
  return (
    <>
      <div className="sf-page-head">
        <div>
          <h1>{found.collection.title}</h1>
          {found.collection.description && <p>{found.collection.description}</p>}
        </div>
        <form className="sf-toolbar">
          <select className="c-select" name="sort" defaultValue={sort ?? ""} aria-label={t("list.sort")} style={{ width: "auto" }}>
            <option value="">{t("list.featured")}</option>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(`sort.${s.value}`)}
              </option>
            ))}
          </select>
          <button type="submit" className="c-btn">
            {t("list.sort")}
          </button>
        </form>
      </div>
      {found.products.length === 0 ? (
        <div className="sf-empty">
          <h2>{t("collection.empty")}</h2>
          <p>{t("collection.emptyText")}</p>
          <a className="sf-btn sf-btn-ghost" href={`/s/${store.slug}/products`}>
            {t("list.seeAll")}
          </a>
        </div>
      ) : (
        <ProductGrid products={found.products} slug={store.slug} currency={store.currency} locale={locale} labels={gridLabels(t)} />
      )}
    </>
  );
}
