import { describe, expect, it } from "vitest";
import { contrast, defaultTheme, isSafeHref, newSection, textOn, themeCssVars, themeProblems } from "./theme";

describe("themes", () => {
  it("starts every store with a valid theme in its language", () => {
    expect(themeProblems(defaultTheme())).toEqual([]);
    expect(defaultTheme("hi-IN").languages).toEqual(["hi"]);
    expect(defaultTheme("fr").languages).toEqual(["en"]);
  });

  it("allows store paths and https links only", () => {
    for (const ok of ["/", "/products", "/c/teas?sort=newest", "https://instagram.com/chaico"]) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.test", "http://insecure.test", "data:text/html,x", "/a b"]) expect(isSafeHref(bad), bad).toBe(false);
  });

  it("explains what's wrong with a theme", () => {
    const t = defaultTheme();
    const broken = {
      ...t,
      colors: { accent: "blue", dark: "#000000" },
      languages: ["en", "xx"],
      header: { links: [{ label: "Bad", href: "javascript:alert(1)" }] },
      sections: [...t.sections, { ...newSection("faq", "hero"), items: [] }],
    };
    expect(themeProblems(broken)).toEqual([
      "colors: use #rrggbb colours",
      "languages: choose at least one supported language",
      "header.links.0.href: use a store path like /products or an https link",
      "sections.3.id: invalid or repeated",
      "sections.3.items: 1 to 12 items",
    ]);
  });

  it("picks readable text for any brand colour", () => {
    expect(textOn("#1257C6")).toBe("#FFFFFF");
    expect(textOn("#F5D547")).toBe("#0B1430");
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    expect(themeCssVars({ colors: { accent: "#F5D547", dark: "#071C45" }, font: "classic", buttons: "pill" })).toMatchObject({ "--sf-on-accent": "#0B1430", "--sf-button-radius": "999px" });
  });
});
