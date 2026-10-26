import { notFound } from "next/navigation";
import { themeCssVars } from "@workeasy/commerce";
import type { CSSProperties, ReactNode } from "react";
import { ShopHeader } from "../../../components/header";
import { PageTracker } from "../../../components/page-tracker";
import { ShopFooter } from "../../../components/shop";
import { I18nProvider } from "../../../components/i18n";
import type { Lang } from "../../../lib/i18n";
import { currentShop, shopI18n } from "../../../lib/shop-context";
import { mediaUrl } from "../../../lib/stores";

/** Every page of a shop: its header with menu and cart, the page, and the footer. */
export default async function ShopLayout({ params, children }: { params: Promise<{ storeSlug: string }>; children: ReactNode }) {
  const { storeSlug } = await params;
  const shop = await currentShop(storeSlug);
  if (!shop) notFound();
  const { theme, store } = shop;
  const i18n = await shopI18n(shop);
  const { t } = i18n;
  const vars = themeCssVars(theme);
  // The logo gradient is the platform's look; a store with its own colour uses that instead.
  const style = { ...vars, ...(theme.colors.accent.toUpperCase() !== "#1257C6" ? { "--we-gradient-brand": theme.colors.accent } : {}) } as CSSProperties;
  const base = `/s/${store.slug}`;
  return (
    <I18nProvider lang={i18n.lang} country={store.country}>
    <div lang={i18n.lang} dir={i18n.dir} className="sf-root" style={style}>
      {shop.preview && (
        <div className="sf-preview-bar" role="status">
          {t("preview.bar")} <a href={`${base}/preview?exit=1`}>{t("preview.exit")}</a>
        </div>
      )}
      {theme.announcement && (
        <aside className="sf-announcement" aria-label={t("announcement.label")}>{theme.announcement.href ? <a href={theme.announcement.href.startsWith("/") ? `${base}${theme.announcement.href === "/" ? "" : theme.announcement.href}` : theme.announcement.href}>{theme.announcement.text}</a> : theme.announcement.text}</aside>
      )}
      <ShopHeader
        slug={store.slug}
        name={store.name}
        collections={shop.collections}
        logoUrl={theme.logoMediaId ? mediaUrl(theme.logoMediaId) : null}
        languages={theme.languages as Lang[]}
        links={theme.header.links.map((l) => ({ label: l.label, href: l.href.startsWith("/") ? `${base}${l.href === "/" ? "" : l.href}` : l.href }))}
      />
      <main className="sf-main">{children}</main>
      <ShopFooter name={store.name} text={theme.footer.text} labels={{ footer: t("footer.label"), powered: t("footer.powered") }} links={theme.footer.links.map((l) => ({ label: l.label, href: l.href.startsWith("/") ? `${base}${l.href === "/" ? "" : l.href}` : l.href }))} />
      <PageTracker slug={store.slug} />
    </div>
    </I18nProvider>
  );
}
