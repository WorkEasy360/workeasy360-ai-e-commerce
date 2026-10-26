"use client";

import { usePathname } from "next/navigation";
import { CartIcon, SearchIcon } from "@workeasy/ui/react";
import { ThemeToggle } from "@workeasy/ui/client";
import { useCart } from "../lib/cart";
import type { Lang } from "../lib/i18n";
import { LanguageSwitcher, useI18n } from "./i18n";
import type { NavCollection } from "../lib/stores";

/** The shop's header: name, collections menu, search, theme and the cart with its count. */
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
  const links = custom.length > 0 ? custom : [{ href: `${base}/products`, label: t("nav.shopAll") }, ...collections.slice(0, 6).map((c) => ({ href: `${base}/c/${c.handle}`, label: c.title }))];
  const nav = (
    <nav className="sf-nav" aria-label={t("nav.label")}>
      {links.map((l) => (
        <a key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
  return (
    <header className="sf-header">
      <div className="sf-header-row">
        <a className="sf-store-name" href={base}>
          {logoUrl ? <img className="sf-logo" src={logoUrl} alt={name} /> : name}
        </a>
        <div className="sf-nav-wrap">{nav}</div>
        <div className="sf-header-end">
          <form className="sf-search" role="search" action={`${base}/products`}>
            <SearchIcon size={16} />
            <input type="search" name="q" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
          </form>
          <LanguageSwitcher languages={languages} />
          <ThemeToggle className="sf-icon-btn" />
          <a className="sf-icon-btn" href={`${base}/cart`} aria-label={tn("cart.aria", count)}>
            <CartIcon />
            {count > 0 && <span className="sf-count">{count > 99 ? "99+" : count}</span>}
          </a>
        </div>
      </div>
      <div className="sf-subnav">{nav}</div>
    </header>
  );
}
