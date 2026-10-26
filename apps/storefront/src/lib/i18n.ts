/**
 * Storefront text in each language a store offers. `t("key", { vars })`
 * fills {placeholders}; `tn("key", n)` picks the plural form the language
 * needs (Arabic has six) from keys like "items.one" / "items.other".
 * Merchant content (product names, the store's own headings) is shown as
 * written; this covers the shop's own words.
 */
import { ar } from "./i18n-ar";
import { en } from "./i18n-en";
import { hi } from "./i18n-hi";

export type Lang = "en" | "hi" | "ar";
export type MessageKey = keyof typeof en;
/** Every language has every key; Arabic adds extra plural forms. */
export type Catalog = Record<MessageKey, string> & Partial<Record<string, string>>;

export const CATALOGS: Record<Lang, Catalog> = { en, hi, ar };
export const RTL: ReadonlySet<Lang> = new Set(["ar"]);
export const LANG_COOKIE = "we-lang";

export type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export interface Translator {
  lang: Lang;
  dir: "ltr" | "rtl";
  /** For numbers, money and dates: the language in the store's country. */
  locale: string;
  t(key: MessageKey, vars?: Vars): string;
  /** Plural text: `base` names keys "<base>.one", "<base>.other" (and Arabic's zero/two/few/many); {n} is the count. */
  tn(base: string, n: number, vars?: Vars): string;
}

export function translator(lang: Lang, country: string): Translator {
  const catalog = CATALOGS[lang];
  const rules = new Intl.PluralRules(lang);
  return {
    lang,
    dir: RTL.has(lang) ? "rtl" : "ltr",
    locale: `${lang}-${country}`,
    t: (key, vars) => fill(catalog[key] ?? en[key], vars),
    tn: (base, n, vars) => {
      const form = rules.select(n);
      const text = catalog[`${base}.${form}`] ?? catalog[`${base}.other`] ?? (en as Record<string, string>)[`${base}.other`] ?? base;
      return fill(text, { n: n.toLocaleString(`${lang}-${country}`), ...vars });
    },
  };
}

/**
 * The language to show: the shopper's choice if the store offers it, else
 * the first of their browser's languages the store offers, else the
 * store's default (its first language).
 */
export function pickLanguage(offered: readonly string[], chosen: string | undefined, acceptLanguage: string | null): Lang {
  const ok = (l: string | undefined): l is Lang => l !== undefined && offered.includes(l) && l in CATALOGS;
  if (ok(chosen)) return chosen;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (ok(code)) return code;
  }
  return ok(offered[0]) ? offered[0] : "en";
}
