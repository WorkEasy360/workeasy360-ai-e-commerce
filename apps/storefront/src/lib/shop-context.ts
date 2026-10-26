import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLanguage, translator } from "./i18n";
import { getShop } from "./stores";

/** The cookie set by a Store Design preview link: "<slug>:<signed token>". */
export const PREVIEW_COOKIE = "we-theme-preview";

/** The shop for this request: its draft theme when the visitor opened a valid preview link for it. */
export async function currentShop(slug: string) {
  const preview = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const token = preview?.startsWith(`${slug}:`) ? preview.slice(slug.length + 1) : undefined;
  return getShop(slug, token);
}

/** The shopper's language for this shop, and text in it, for server components. */
export async function shopI18n(shop: { store: { country: string }; theme: { languages: readonly string[] } }) {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const lang = pickLanguage(shop.theme.languages, jar.get(LANG_COOKIE)?.value, h.get("accept-language"));
  return translator(lang, shop.store.country);
}
