import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SearchIcon } from "@workeasy/ui/react";
import { gridLabels, ProductGrid } from "../../../../components/shop";
import { currentShop, shopI18n } from "../../../../lib/shop-context";
import { getProducts, parseSort, SORTS } from "../../../../lib/stores";

type Props = { params: Promise<{ storeSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const shop = await currentShop((await params).storeSlug);
  const q = (await searchParams).q;
  if (!shop) return { title: "Store not found" };
  const { t } = await shopI18n(shop);
  return { title: `${typeof q === "string" && q ? `“${q}”` : t("list.all")} · ${shop.store.name}` };
}

/** Every product on sale, with search, sorting and pages. */
export default async function AllProducts({ params, searchParams }: Props) {
  const { storeSlug } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const sort = parseSort(sp.sort) ?? "newest";
  const page = Math.max(1, Number(sp.page) || 1);
  const [shop, result] = await Promise.all([currentShop(storeSlug), getProducts(storeSlug, { q, sort, page })]);
  if (!shop || !result) notFound();
  const { store } = shop;
  const { t, tn, locale } = await shopI18n(shop);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (p: number) => `/s/${store.slug}/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== "newest" ? { sort } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <>
      <div className="sf-page-head">
        <div>
          <h1>{q ? t("list.results", { q }) : t("list.all")}</h1>
          <p>{tn("list.count", result.total)}</p>
        </div>
        <form className="sf-toolbar" action={`/s/${store.slug}/products`}>
          <div className="c-search" style={{ minWidth: 200 }}>
            <SearchIcon size={16} />
            <input className="c-input" type="search" name="q" defaultValue={q} placeholder={t("list.search")} aria-label={t("search.placeholder")} />
          </div>
          <select className="c-select" name="sort" defaultValue={sort} aria-label={t("list.sort")} style={{ width: "auto" }}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(`sort.${s.value}`)}
              </option>
            ))}
          </select>
          <button type="submit" className="c-btn">
            {t("list.apply")}
          </button>
        </form>
      </div>
      {result.products.length === 0 ? (
        <div className="sf-empty">
          <h2>{t("list.nothing")}</h2>
          <p>{q ? t("list.tryOther") : t("list.noneOnSale")}</p>
          {q && (
            <a className="sf-btn sf-btn-ghost" href={`/s/${store.slug}/products`}>
              {t("list.seeAll")}
            </a>
          )}
        </div>
      ) : (
        <ProductGrid products={result.products} slug={store.slug} currency={store.currency} locale={locale} labels={gridLabels(t)} />
      )}
      {pages > 1 && (
        <nav className="sf-pager" aria-label={t("list.pages")}>
          {page > 1 && (
            <a className="c-btn" href={link(page - 1)}>
              {t("list.previous")}
            </a>
          )}
          <span className="c-btn c-btn-ghost" aria-current="page">
            {t("list.page", { page, pages })}
          </span>
          {page < pages && (
            <a className="c-btn" href={link(page + 1)}>
              {t("list.next")}
            </a>
          )}
        </nav>
      )}
    </>
  );
}
