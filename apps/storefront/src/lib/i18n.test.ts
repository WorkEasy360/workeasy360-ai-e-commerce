import { describe, expect, it } from "vitest";
import { ar } from "./i18n-ar";
import { en } from "./i18n-en";
import { hi } from "./i18n-hi";
import { pickLanguage, translator } from "./i18n";

describe("storefront languages", () => {
  it("picks the shopper's choice, then their browser's language, then the store default", () => {
    expect(pickLanguage(["en", "hi"], "hi", "ar,en")).toBe("hi");
    expect(pickLanguage(["en", "ar"], "hi", "ar-SA,ar;q=0.9,en;q=0.5")).toBe("ar");
    expect(pickLanguage(["hi", "en"], undefined, "fr-FR,de")).toBe("hi");
    expect(pickLanguage(["en"], "ar", "ar")).toBe("en");
  });

  it("fills placeholders and uses each language's plural rules", () => {
    const e = translator("en", "IN");
    expect(e.t("list.page", { page: 2, pages: 5 })).toBe("Page 2 of 5");
    expect(e.tn("list.count", 1)).toBe("1 product");
    expect(e.tn("list.count", 1200)).toBe("1,200 products");
    const a = translator("ar", "AE");
    expect(a.dir).toBe("rtl");
    expect(a.tn("list.count", 2)).toBe("منتجان");
    expect(a.tn("list.count", 5)).toBe(`${(5).toLocaleString("ar-AE")} منتجات`);
    expect(translator("hi", "IN").t("cart.addMore", { amount: "₹100" })).toBe("मुफ़्त डिलीवरी के लिए ₹100 और जोड़ें।");
  });

  it("has every message in every language, with the same placeholders", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();
    for (const catalog of [hi, ar] as Array<Record<string, string>>) {
      for (const key of Object.keys(en)) expect(catalog[key], key).toBeTruthy();
      // Arabic often spells out one and two ("منتج واحد"), so its {n} may go there.
      const comparable = Object.entries(en).filter(([key]) => !(catalog === ar && /\.(one|two)$/.test(key)));
      for (const [key, text] of comparable) expect(vars(catalog[key]!), key).toEqual(vars(text));
    }
  });
});
