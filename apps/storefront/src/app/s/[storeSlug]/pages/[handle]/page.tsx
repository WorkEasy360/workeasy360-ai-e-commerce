import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contentSummary, parseContent } from "@workeasy/commerce";
import { RichContent } from "@workeasy/ui/react";
import { currentShop } from "../../../../../lib/shop-context";
import { getPage } from "../../../../../lib/stores";

type Props = { params: Promise<{ storeSlug: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storeSlug, handle } = await params;
  const [shop, page] = await Promise.all([currentShop(storeSlug), getPage(storeSlug, handle)]);
  if (!shop || !page) return { title: "Not found" };
  return { title: `${page.seoTitle ?? page.title} · ${shop.store.name}`, description: page.seoDescription ?? (contentSummary(page.body) || undefined) };
}

/** A merchant's content page: About us, policies, contact. Merchant text is shown as written, in its own direction. */
export default async function ContentPage({ params }: Props) {
  const { storeSlug, handle } = await params;
  const [shop, page] = await Promise.all([currentShop(storeSlug), getPage(storeSlug, handle)]);
  if (!shop || !page) notFound();
  const base = `/s/${shop.store.slug}`;
  return (
    <article className="sf-content">
      <h1>{page.title}</h1>
      <RichContent blocks={parseContent(page.body)} resolveHref={(h) => (h.startsWith("/") ? `${base}${h === "/" ? "" : h}` : h)} />
    </article>
  );
}
