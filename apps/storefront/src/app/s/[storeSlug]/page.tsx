import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney, type ThemeSection } from "@workeasy/commerce";
import { ArrowRightIcon, CartIcon, CheckIcon, PaymentIcon, ProductIcon, StoreIcon, TruckIcon } from "@workeasy/ui/react";
import { gridLabels, ProductGrid } from "../../../components/shop";
import { currentShop, shopI18n } from "../../../lib/shop-context";
import { getCollection, getProducts, mediaUrl, type ProductCard } from "../../../lib/stores";

type Params = Promise<{ storeSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) return { title: "Store not found" };
  return { title: shop.store.name, description: `Shop ${shop.store.name} online.`, openGraph: { title: shop.store.name, type: "website" } };
}

/**
 * A shop's home page: the sections from its theme, in order, styled as in
 * the Commerce designs. After the first hero comes a strip of what the shop
 * really offers (delivery, pickup, ways to pay), taken from its settings.
 */
export default async function StoreHome({ params }: { params: Params }) {
  const { storeSlug } = await params;
  const shop = await currentShop(storeSlug);
  if (!shop) notFound();
  const { store, collections, theme, checkout } = shop;
  const { t, locale } = await shopI18n(shop);
  const labels = gridLabels(t);
  const newest = await getProducts(store.slug, { sort: "newest" });
  const open = newest !== undefined && newest.total > 0;
  const base = `/s/${store.slug}`;
  const href = (h: string) => (h.startsWith("/") ? `${base}${h === "/" ? "" : h}` : h);

  // Product grids for collections, fetched once each.
  const grids = new Map<string, ProductCard[]>();
  for (const s of theme.sections) {
    if (s.type === "featured_products" && s.collectionHandle && !grids.has(s.collectionHandle)) {
      grids.set(s.collectionHandle, (await getCollection(store.slug, s.collectionHandle))?.products ?? []);
    }
  }

  // A photo for each category tile: its own image, or its first product's.
  const tileImages = new Map<string, string | null>();
  if (theme.sections.some((x) => x.type === "collection_list")) {
    for (const c of collections.slice(0, 6)) {
      tileImages.set(c.handle, c.imageId ?? (await getCollection(store.slug, c.handle))?.products.find((x) => x.imageId)?.imageId ?? null);
    }
  }

  // What the shop really offers, in the shopper's words.
  const methods = checkout.paymentMethods;
  const trust = [
    checkout.delivery.enabled && { icon: <TruckIcon size={26} />, title: t("trust.delivery"), text: checkout.delivery.freeOverMinor ? t("trust.deliveryFree", { amount: formatMoney(checkout.delivery.freeOverMinor, store.currency, locale, { compact: true }) }) : t("trust.deliveryText") },
    checkout.pickup && { icon: <StoreIcon size={26} />, title: t("trust.pickup"), text: t("trust.pickupText") },
    methods.includes("card") && { icon: <PaymentIcon size={26} />, title: t("trust.online"), text: t("trust.onlineText") },
    methods.includes("cod") && { icon: <CheckIcon size={26} />, title: t("trust.cod"), text: t("trust.codText") },
    methods.includes("upi") && { icon: <PaymentIcon size={26} />, title: t("trust.upi"), text: t("trust.upiText") },
    methods.includes("bank") && { icon: <CartIcon size={26} />, title: t("trust.bank"), text: t("trust.bankText") },
  ].filter((x): x is { icon: React.ReactElement; title: string; text: string } => Boolean(x)).slice(0, 4);
  const firstHero = theme.sections.find((x) => x.type === "hero")?.id;

  const render = (section: ThemeSection) => {
    const id = `s-${section.id}`;
    switch (section.type) {
      case "hero":
        return (
          <div key={section.id}>
            <section className={`sf-hero${section.imageId ? " sf-hero-image" : ""}`} aria-labelledby={id}>
              <div className="sf-hero-text">
                <span className="sf-pill">{open ? t("home.open") : t("home.soon")}</span>
                <h1 id={id}>{section.heading || store.name}</h1>
                <p>{open ? section.text : t("home.stocking")}</p>
                {open && section.buttonLabel && (
                  <a className="sf-btn" href={href(section.buttonHref)}>
                    <CartIcon size={18} /> {section.buttonLabel} <ArrowRightIcon size={16} />
                  </a>
                )}
              </div>
              {section.imageId && <img className="sf-hero-art" src={mediaUrl(section.imageId)} alt="" />}
            </section>
            {section.id === firstHero && trust.length > 0 && (
              <ul className="sf-trust" aria-label={t("trust.label")}>
                {trust.map((x) => (
                  <li key={x.title}>
                    <span aria-hidden="true">{x.icon}</span>
                    <div>
                      <strong>{x.title}</strong>
                      <small>{x.text}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "collection_list":
        return collections.length === 0 ? null : (
          <section key={section.id} className="sf-section" aria-labelledby={id}>
            <div className="sf-section-head">
              <h2 id={id}>{section.heading || t("home.categories")}</h2>
              <a href={`${base}/products`}>
                {t("home.viewAll")} <ArrowRightIcon size={14} />
              </a>
            </div>
            <div className="sf-cats">
              {collections.slice(0, 6).map((c) => {
                const img = tileImages.get(c.handle) ?? null;
                return (
                  <a key={c.handle} className="sf-cat" href={`${base}/c/${c.handle}`}>
                    <span className="sf-cat-img">{img ? <img src={mediaUrl(img)} alt="" loading="lazy" /> : <ProductIcon size={30} />}</span>
                    <span>{c.title}</span>
                  </a>
                );
              })}
              <a className="sf-cat" href={`${base}/products`}>
                <span className="sf-cat-img sf-cat-more">
                  <ArrowRightIcon size={26} />
                </span>
                <span>{t("home.viewAll")}</span>
              </a>
            </div>
          </section>
        );
      case "featured_products": {
        const products = section.collectionHandle ? (grids.get(section.collectionHandle) ?? []) : (newest?.products ?? []);
        const more = section.collectionHandle ? `${base}/c/${section.collectionHandle}` : `${base}/products`;
        return (
          <section key={section.id} className="sf-section" aria-labelledby={id}>
            <div className="sf-section-head">
              <h2 id={id}>{section.heading}</h2>
              {products.length > 0 && (
                <a href={more}>
                  {t("home.viewAll")} <ArrowRightIcon size={14} />
                </a>
              )}
            </div>
            {products.length > 0 ? (
              <ProductGrid products={products.slice(0, section.limit)} slug={store.slug} currency={store.currency} locale={locale} labels={labels} />
            ) : (
              <div className="sf-empty">
                <ProductIcon size={34} />
                <h2>{t("home.comingSoon")}</h2>
                <p>{t("home.comingSoonText")}</p>
              </div>
            )}
          </section>
        );
      }
      case "banner":
        return (
          <section key={section.id} className="sf-section sf-banner" aria-labelledby={id}>
            {section.imageId && <img src={mediaUrl(section.imageId)} alt="" loading="lazy" />}
            <div>
              <h2 id={id}>{section.heading}</h2>
              {section.text && <p>{section.text}</p>}
              {section.buttonLabel && (
                <a className="sf-btn" href={href(section.buttonHref)}>
                  {section.buttonLabel}
                </a>
              )}
            </div>
          </section>
        );
      case "testimonials":
        return (
          <section key={section.id} className="sf-section" aria-labelledby={id}>
            <div className="sf-section-head">
              <h2 id={id}>{section.heading}</h2>
            </div>
            <div className="sf-quotes">
              {section.items.map((q, i) => (
                <figure key={i}>
                  <blockquote>“{q.quote}”</blockquote>
                  <figcaption>{q.author}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        );
      case "faq":
        return (
          <section key={section.id} className="sf-section sf-faq" aria-labelledby={id}>
            <div className="sf-section-head">
              <h2 id={id}>{section.heading}</h2>
            </div>
            {section.items.map((q, i) => (
              <details key={i}>
                <summary>{q.question}</summary>
                <p>{q.answer}</p>
              </details>
            ))}
          </section>
        );
      case "rich_text":
        return (
          <section key={section.id} className="sf-section sf-richtext" aria-labelledby={id}>
            <h2 id={id}>{section.heading}</h2>
            <p>{section.text}</p>
          </section>
        );
    }
  };

  return <>{theme.sections.map(render)}</>;
}
