/**
 * A store's theme: colours, type, logo, menus, languages and the home page
 * as a list of sections. The admin edits it, the API validates it with
 * themeProblems, and the storefront renders it. Links are store paths or
 * https URLs only, so a theme can't carry a script link.
 */

export const THEME_FONTS = ["modern", "classic", "rounded"] as const;
export const THEME_BUTTONS = ["rounded", "pill", "square"] as const;
export const SECTION_TYPES = ["hero", "featured_products", "collection_list", "banner", "testimonials", "faq", "rich_text"] as const;
export const MAX_SECTIONS = 20;
export const MAX_LINKS = 8;

/** Storefront languages with full shopper-facing text. Arabic reads right to left. */
export const STORE_LANGUAGES = [
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
] as const;
export type StoreLanguage = (typeof STORE_LANGUAGES)[number]["code"];

export interface ThemeLink {
  label: string;
  href: string;
}

export type ThemeSection =
  | { id: string; type: "hero"; heading: string; text: string; buttonLabel: string; buttonHref: string; imageId: string | null }
  | { id: string; type: "featured_products"; heading: string; collectionHandle: string | null; limit: number }
  | { id: string; type: "collection_list"; heading: string }
  | { id: string; type: "banner"; heading: string; text: string; buttonLabel: string; buttonHref: string; imageId: string | null }
  | { id: string; type: "testimonials"; heading: string; items: Array<{ quote: string; author: string }> }
  | { id: string; type: "faq"; heading: string; items: Array<{ question: string; answer: string }> }
  | { id: string; type: "rich_text"; heading: string; text: string };

export type SectionType = ThemeSection["type"];

export interface Theme {
  version: 1;
  colors: { accent: string; dark: string };
  font: (typeof THEME_FONTS)[number];
  buttons: (typeof THEME_BUTTONS)[number];
  logoMediaId: string | null;
  announcement: { text: string; href: string | null } | null;
  /** Languages shoppers can pick; the first is the default. */
  languages: StoreLanguage[];
  header: { links: ThemeLink[] };
  footer: { links: ThemeLink[]; text: string };
  sections: ThemeSection[];
}

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  featured_products: "Product grid",
  collection_list: "Collections",
  banner: "Banner",
  testimonials: "Testimonials",
  faq: "FAQ",
  rich_text: "Text",
};

/** A new section of a type, with placeholder content the merchant replaces. */
export function newSection(type: SectionType, id: string): ThemeSection {
  switch (type) {
    case "hero":
      return { id, type, heading: "", text: "Browse the collection, order in a few taps, and pay the way that suits you.", buttonLabel: "Shop now", buttonHref: "/products", imageId: null };
    case "featured_products":
      return { id, type, heading: "New in", collectionHandle: null, limit: 8 };
    case "collection_list":
      return { id, type, heading: "Shop by collection" };
    case "banner":
      return { id, type, heading: "Free delivery over ₹999", text: "Across India, on every order.", buttonLabel: "Shop now", buttonHref: "/products", imageId: null };
    case "testimonials":
      return { id, type, heading: "What our customers say", items: [{ quote: "Lovely quality and quick delivery.", author: "A happy customer" }] };
    case "faq":
      return { id, type, heading: "Questions", items: [{ question: "How long does delivery take?", answer: "Most orders arrive in 3 to 5 days." }] };
    case "rich_text":
      return { id, type, heading: "Our story", text: "Tell shoppers who you are and what you make." };
  }
}

/** What every store starts with: the layout the storefront has always had, in the brand colours. */
export function defaultTheme(defaultLanguage = "en"): Theme {
  const lang = (STORE_LANGUAGES.find((l) => l.code === defaultLanguage.split("-")[0])?.code ?? "en") as StoreLanguage;
  return {
    version: 1,
    colors: { accent: "#1257C6", dark: "#071C45" },
    font: "modern",
    buttons: "rounded",
    logoMediaId: null,
    announcement: null,
    languages: [lang],
    header: { links: [] },
    footer: { links: [], text: "" },
    sections: [
      { ...(newSection("hero", "hero") as Extract<ThemeSection, { type: "hero" }>), heading: "" },
      newSection("collection_list", "collections"),
      newSection("featured_products", "new-in"),
    ],
  };
}

// Validation -----------------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9-]{1,40}$/;
const HANDLE = /^[a-z0-9-]{1,100}$/;

/** Store paths ("/products", "/c/teas") or https links; nothing else. */
export function isSafeHref(href: string): boolean {
  if (href === "/" || /^\/[A-Za-z0-9/_.~%-]*(\?[A-Za-z0-9=&_.~%-]*)?$/.test(href)) return !href.startsWith("//");
  return href.length <= 500 && /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d{1,5})?(\/[A-Za-z0-9/_.~%+:@!$&'()*,;=-]*)?(\?[A-Za-z0-9/_.~%+:@!$&'()*,;=?-]*)?(#[A-Za-z0-9_.~%-]*)?$/.test(href);
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].toSorted((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** White or near-black text, whichever reads better on the colour. */
export function textOn(hex: string): string {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#0B1430") ? "#FFFFFF" : "#0B1430";
}

/** Problems with a theme, as "path: message"; empty when it's valid. */
export function themeProblems(value: unknown): string[] {
  const p: string[] = [];
  const t = value as Partial<Theme>;
  const text = (path: string, v: unknown, max: number, required = false) => {
    if (typeof v !== "string" || v.length > max || (required && v.trim() === "")) p.push(`${path}: ${required ? "required, " : ""}up to ${max} characters`);
  };
  const link = (path: string, l: unknown) => {
    const o = (l ?? {}) as Partial<ThemeLink>;
    text(`${path}.label`, o.label, 40, true);
    if (typeof o.href !== "string" || !isSafeHref(o.href)) p.push(`${path}.href: use a store path like /products or an https link`);
  };
  if (!t || typeof t !== "object") return ["theme: not an object"];
  if (t.version !== 1) p.push("version: must be 1");
  if (!t.colors || !HEX.test(t.colors.accent ?? "") || !HEX.test(t.colors.dark ?? "")) p.push("colors: use #rrggbb colours");
  if (!THEME_FONTS.includes(t.font as never)) p.push("font: unknown font");
  if (!THEME_BUTTONS.includes(t.buttons as never)) p.push("buttons: unknown button style");
  if (t.logoMediaId !== null && !UUID.test(String(t.logoMediaId))) p.push("logoMediaId: not a media id");
  if (t.announcement !== null) {
    if (!t.announcement || typeof t.announcement !== "object") p.push("announcement: invalid");
    else {
      text("announcement.text", t.announcement.text, 120, true);
      if (t.announcement.href !== null && (typeof t.announcement.href !== "string" || !isSafeHref(t.announcement.href))) p.push("announcement.href: use a store path or an https link");
    }
  }
  if (!Array.isArray(t.languages) || t.languages.length === 0 || t.languages.length > STORE_LANGUAGES.length || new Set(t.languages).size !== t.languages.length || t.languages.some((l) => !STORE_LANGUAGES.some((s) => s.code === l))) {
    p.push("languages: choose at least one supported language");
  }
  for (const [name, links] of [["header", t.header?.links], ["footer", t.footer?.links]] as const) {
    if (!Array.isArray(links) || links.length > MAX_LINKS) p.push(`${name}.links: up to ${MAX_LINKS} links`);
    else links.forEach((l, i) => link(`${name}.links.${i}`, l));
  }
  text("footer.text", t.footer?.text, 300);
  if (!Array.isArray(t.sections) || t.sections.length > MAX_SECTIONS) return [...p, `sections: up to ${MAX_SECTIONS} sections`];
  const ids = new Set<string>();
  t.sections.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const at = `sections.${i}`;
    if (typeof s.id !== "string" || !ID.test(s.id) || ids.has(s.id)) p.push(`${at}.id: invalid or repeated`);
    else ids.add(s.id);
    if (!SECTION_TYPES.includes(s.type as never)) return void p.push(`${at}.type: unknown section`);
    text(`${at}.heading`, s.heading, 120, s.type !== "hero");
    switch (s.type as SectionType) {
      case "hero":
      case "banner":
        text(`${at}.text`, s.text, 400);
        text(`${at}.buttonLabel`, s.buttonLabel, 40);
        if (typeof s.buttonHref !== "string" || !isSafeHref(s.buttonHref)) p.push(`${at}.buttonHref: use a store path or an https link`);
        if (s.imageId !== null && !UUID.test(String(s.imageId))) p.push(`${at}.imageId: not a media id`);
        break;
      case "featured_products":
        if (s.collectionHandle !== null && (typeof s.collectionHandle !== "string" || !HANDLE.test(s.collectionHandle))) p.push(`${at}.collectionHandle: not a collection`);
        if (typeof s.limit !== "number" || !Number.isInteger(s.limit) || s.limit < 2 || s.limit > 24) p.push(`${at}.limit: 2 to 24 products`);
        break;
      case "testimonials":
      case "faq": {
        const items = s.items;
        if (!Array.isArray(items) || items.length === 0 || items.length > 12) p.push(`${at}.items: 1 to 12 items`);
        else
          items.forEach((it, j) => {
            const o = (it ?? {}) as Record<string, unknown>;
            if (s.type === "faq") {
              text(`${at}.items.${j}.question`, o.question, 200, true);
              text(`${at}.items.${j}.answer`, o.answer, 1000, true);
            } else {
              text(`${at}.items.${j}.quote`, o.quote, 400, true);
              text(`${at}.items.${j}.author`, o.author, 60, true);
            }
          });
        break;
      }
      case "rich_text":
        text(`${at}.text`, s.text, 4000, true);
        break;
      case "collection_list":
        break;
    }
  });
  return p;
}

/** CSS custom properties for a theme, applied on the storefront's root element. */
export function themeCssVars(t: Pick<Theme, "colors" | "font" | "buttons">): Record<string, string> {
  const fonts = {
    modern: "Inter, ui-sans-serif, system-ui, sans-serif",
    classic: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif',
  };
  const radius = { rounded: "14px", pill: "999px", square: "4px" };
  return {
    "--we-color-accent": t.colors.accent,
    "--we-color-navy": t.colors.dark,
    "--sf-on-accent": textOn(t.colors.accent),
    "--sf-on-dark": textOn(t.colors.dark),
    "--sf-font": fonts[t.font],
    "--sf-button-radius": radius[t.buttons],
  };
}
