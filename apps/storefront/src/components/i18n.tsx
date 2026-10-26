"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { LANG_COOKIE, translator, type Lang, type Translator } from "../lib/i18n";

const I18nContext = createContext<Translator>(translator("en", "IN"));

/** Gives client components the shop's text in the shopper's language. */
export function I18nProvider({ lang, country, children }: { lang: Lang; country: string; children: ReactNode }) {
  const value = useMemo(() => translator(lang, country), [lang, country]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Translator {
  return useContext(I18nContext);
}

const NAMES: Record<Lang, string> = { en: "English", hi: "हिन्दी", ar: "العربية" };

/** Lets shoppers switch between the store's languages; remembered for a year. */
export function LanguageSwitcher({ languages }: { languages: readonly Lang[] }) {
  const { lang, t } = useI18n();
  if (languages.length < 2) return null;
  return (
    <select
      className="sf-lang"
      aria-label={t("language.label")}
      value={lang}
      onChange={(e) => {
        document.cookie = `${LANG_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        window.location.reload();
      }}
    >
      {languages.map((l) => (
        <option key={l} value={l} lang={l}>
          {NAMES[l]}
        </option>
      ))}
    </select>
  );
}
