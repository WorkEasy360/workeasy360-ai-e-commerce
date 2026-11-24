"use client";

import { usePathname } from "next/navigation";
import { CartIcon, HomeIcon, SearchIcon, StoreIcon } from "@workeasy/ui/react";
import { ThemeToggle } from "@workeasy/ui/client";
import { useCart } from "../lib/cart";
import type { Lang } from "../lib/i18n";
import { LanguageSwitcher, useI18n } from "./i18n";
import type { NavCollection } from "../lib/stores";

/**
 * The shop's header, as in the Commerce designs: the shop's logo and name, a
 * wide search, the cart with its count, and a bar in the shop's dark colour
 * with Home, Shop all and the collections (or the menu from Store Design).
 */
export function ShopHeader({
  slug,
  name,
  collections,
  logoUrl = null,
  links: custom = [],
  languages = [],
}: {
  slug: string;
  name: string;
  collections: NavCollection[];
  logoUrl?: string | null;
  /** The theme's menu; empty for "Shop all" and the collections. */
  links?: Array<{ label: string; href: string }>;
  languages?: Lang[];
}) {
  const { t, tn } = useI18n();
  const pathname = usePathname();
  const { count } = useCart(slug);
  const base = `/s/${slug}`;
  const links = [
    { href: base, label: t("nav.home") },
    ...(custom.length > 0 ? custom : [{ href: `${base}/products`, label: t("nav.shopAll") }, ...collections.slice(0, 7).map((c) => ({ href: `${base}/c/${c.handle}`, label: c.title }))]),
  ];
  return (
    <header className="sf-header">
      <div className="sf-header-row">
        <a className="sf-brand" href={base}>
          {logoUrl ? (
            <img className="sf-logo" src={logoUrl} alt={name} />
          ) : (
            <>
              <span className="sf-brand-tile" aria-hidden="true">
                <StoreIcon size={24} />
              </span>
              <strong>{name}</strong>
            </>
          )}
        </a>
        <form className="sf-search" role="search" action={`${base}/products`}>
          <SearchIcon size={18} />
          <input type="search" name="q" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
          <button type="submit" className="sf-search-go" aria-label={t("nav.search")}>
            <SearchIcon size={18} />
          </button>
        </form>
        <div className="sf-header-end">
          <LanguageSwitcher languages={languages} />
          <ThemeToggle className="sf-icon-btn sf-hide-sm" />
          <a className="sf-cart-link" href={`${base}/cart`} aria-label={tn("cart.aria", count)}>
            <span className="sf-cart-icon">
              <CartIcon size={24} />
              {count > 0 && <span className="sf-count">{count > 99 ? "99+" : count}</span>}
            </span>
            <span className="sf-cart-label" aria-hidden="true">
              {t("nav.cart")}
            </span>
          </a>
        </div>
      </div>
      <nav className="sf-catbar" aria-label={t("nav.label")}>
        <div>
          {links.map((l) => (
            <a key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </div>
      </nav>
    </header>
  );
}

/** Phones: Home, Categories, Search and Cart as a bar along the bottom. */
export function ShopTabBar({ slug }: { slug: string }) {
  const { t, tn } = useI18n();
  const pathname = usePathname();
  const { count } = useCart(slug);
  const base = `/s/${slug}`;
  const here = (href: string) => (pathname === href ? "page" : undefined);
  return (
    <nav className="sf-tabbar" aria-label={t("nav.bar")}>
      <a href={base} aria-current={here(base)}>
        <HomeIcon size={22} />
        {t("nav.home")}
      </a>
      <a href={`${base}/products`} aria-current={here(`${base}/products`)}>
        <StoreIcon size={22} />
        {t("nav.categories")}
      </a>
      <a href={`${base}/products#search`}>
        <SearchIcon size={22} />
        {t("nav.search")}
      </a>
      <a href={`${base}/cart`} aria-current={here(`${base}/cart`)} aria-label={tn("cart.aria", count)}>
        <span className="sf-cart-icon">
          <CartIcon size={22} />
          {count > 0 && <span className="sf-count">{count > 99 ? "99+" : count}</span>}
        </span>
        <span aria-hidden="true">{t("nav.cart")}</span>
      </a>
    </nav>
  );
}
