import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ThemeSection } from "@workeasy/commerce";
import { ArrowRightIcon, ProductIcon } from "@workeasy/ui/react";
import { gridLabels, ProductGrid } from "../../../components/shop";
import { currentShop, shopI18n } from "../../../lib/shop-context";
import { getCollection, getProducts, mediaUrl, type ProductCard } from "../../../lib/stores";

type Params = Promise<{ storeSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shop = await currentShop((await params).storeSlug);
  if (!shop) return { title: "Store not found" };
  return { title: shop.store.name, description: `Shop ${shop.store.name} online.`, openGraph: { title: shop.store.name, type: "website" } };
}

/** A shop's home page: the sections from its theme, in order. */
export default async function StoreHome({ params }: { params: Params }) {
  const { storeSlug } = await params;
  const shop = await currentShop(storeSlug);
  if (!shop) notFound();
  const { store, collections, theme } = shop;
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

  const render = (section: ThemeSection) => {
    const id = `s-${section.id}`;
    switch (section.type) {
      case "hero":
        return (
          <section key={section.id} className={`sf-hero${section.imageId ? " sf-hero-image" : ""}`} aria-labelledby={id} style={section.imageId ? { backgroundImage: `linear-gradient(90deg, color-mix(in srgb, var(--we-color-navy) 88%, transparent) 30%, transparent), url(${mediaUrl(section.imageId)})` } : undefined}>
            <span className="sf-pill">{open ? t("home.open") : t("home.soon")}</span>
            <h1 id={id}>{section.heading || store.name}</h1>
            <p>{open ? section.text : t("home.stocking")}</p>
            {open && section.buttonLabel && (
              <a className="sf-btn sf-btn-light" href={href(section.buttonHref)}>
                {section.buttonLabel} <ArrowRightIcon size={16} />
              </a>
            )}
          </section>
        );
      case "collection_list":
        return collections.length === 0 ? null : (
          <section key={section.id} className="sf-section" aria-labelledby={id}>
            <div className="sf-section-head">
              <h2 id={id}>{section.heading}</h2>
            </div>
            <div className="sf-tiles">
              {collections.slice(0, 6).map((c) => (
                <a key={c.handle} className="sf-tile" href={`${base}/c/${c.handle}`}>
                  {c.imageId && <img src={mediaUrl(c.imageId)} alt="" loading="lazy" />}
                  <span>{c.title}</span>
                </a>
              ))}
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
              {products.length > section.limit && <a href={more}>{t("home.viewAll")}</a>}
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
