/**
 * WorkEasy360 design tokens, shared by every product in the WorkEasy360
 * suite (docs/01-design-system.md). The Commerce look (Nov 2026 designs) is
 * green, deep teal and white: a deep teal sidebar, green for primary actions
 * and the current page, white cards with soft shadows on a pale canvas, and
 * colourful icon tiles for figures.
 *
 * The action green is deep enough to carry white text (5:1). The brighter
 * `greenBright` is for fills without text: progress, ticks, chart lines. Status colours come in
 * three steps: the base (icons, dots, borders), a pale `soft` background,
 * and a dark `text` foreground that passes contrast on that background.
 */
export const brand = {
  navy: "#1B3040",
  navyDeep: "#112532",
  navySoft: "#27455A",
  /** Buttons and the selected menu item: white text passes AA (5:1). */
  green: "#15803D",
  greenHover: "#166534",
  /** Fills without text: progress bars, ticks, chart lines. */
  greenBright: "#22C55E",
  greenLight: "#E8F7EE",
  greenDark: "#166534",
  /** The AI assistant's original bright green (its avatar and chat keep their first look). */
  agentGreen: "#4ADE80",
  /** The sidebar's deep teal. */
  teal: "#0F2B2F",
  tealDeep: "#0A2125",
  white: "#FFFFFF",
  /** The logo's own green (packages/ui/assets/logo.jpg), used only for the mark itself. */
  logo: "#00BF62",
} as const;

export const tokens = {
  color: {
    // Brand roles.
    primary: brand.navy,
    primaryHover: brand.navyDeep,
    primarySoft: brand.navySoft,
    onPrimary: brand.white,
    accent: brand.green,
    accentHover: brand.greenHover,
    accentSoft: brand.greenLight,
    accentStrong: brand.greenDark,
    onAccent: brand.white,
    /** Fills without text (progress, ticks, chart area). */
    accentBright: brand.greenBright,
    // Surfaces and lines.
    background: "#F4F7F5",
    surface: brand.white,
    surfaceMuted: "#F1F5F9",
    border: "#E5EBE8",
    borderStrong: "#CBD5D1",
    /** Outlines of text fields: 3:1 against every surface they sit on (WCAG 1.4.11). */
    borderInput: "#7D8BA0",
    overlay: "rgb(17 37 50 / .48)",
    // Text.
    textPrimary: brand.navy,
    textBody: "#334155",
    // Darker than slate-500 so it passes 4.5:1 on the tinted canvas and pale greens too.
    textSecondary: "#5B6B7E",
    link: brand.green,
    focus: brand.green,
    // Semantic: base, pale background, dark foreground.
    success: "#16A34A",
    successSoft: "#DCFCE7",
    successText: "#166534",
    info: "#2563EB",
    infoSoft: "#DBEAFE",
    infoText: "#1E40AF",
    warning: "#D97706",
    warningSoft: "#FEF3C7",
    warningText: "#92400E",
    error: "#DC2626",
    errorSoft: "#FEE2E2",
    errorText: "#991B1B",
    ai: "#7C3AED",
    aiSoft: "#EDE9FE",
    aiText: "#5B21B6",
    rating: "#B45309",
    // The navigation shell.
    sidebar: brand.teal,
    sidebarBorder: brand.teal,
    sidebarText: "#D5E3DF",
    sidebarMuted: "#9DB5AF",
    sidebarActive: brand.white,
    sidebarHover: "rgb(255 255 255 / .07)",
    sidebarSelected: brand.green,
    // Icon tiles for figures: a pale fill with a strong icon colour (cart, money, people, box).
    tileGreenSoft: "#E8F7EE",
    tileGreen: "#15803D",
    tileAmberSoft: "#FFF3E0",
    tileAmber: "#C2410C",
    tileBlueSoft: "#E7F0FF",
    tileBlue: "#1D4ED8",
    tilePinkSoft: "#FCE8F6",
    tilePink: "#A21CAF",
  },
  colorDark: {
    primary: brand.navySoft,
    primaryHover: "#315770",
    primarySoft: "#36576E",
    onPrimary: brand.white,
    accent: "#4ADE80",
    accentHover: brand.greenBright,
    accentSoft: "#193F3D",
    accentStrong: "#4ADE80",
    onAccent: brand.navyDeep,
    accentBright: brand.greenBright,
    background: "#0B1620",
    surface: brand.navyDeep,
    surfaceMuted: "#16303F",
    border: brand.navySoft,
    borderStrong: "#36576E",
    borderInput: "#5A7A91",
    overlay: "rgb(0 0 0 / .6)",
    textPrimary: "#F1F5F9",
    textBody: "#CBD5E1",
    textSecondary: "#94A3B8",
    link: "#4ADE80",
    focus: "#4ADE80",
    success: "#22C55E",
    successSoft: "#173A35",
    successText: "#86EFAC",
    info: "#60A5FA",
    infoSoft: "#1A3352",
    infoText: "#93C5FD",
    warning: "#F59E0B",
    warningSoft: "#3A3424",
    warningText: "#FCD34D",
    error: "#F87171",
    errorSoft: "#3D2832",
    errorText: "#FCA5A5",
    ai: "#A78BFA",
    aiSoft: "#2A2D52",
    aiText: "#C4B5FD",
    rating: "#FBBF24",
    sidebar: brand.tealDeep,
    sidebarBorder: "#16363A",
    sidebarText: "#D5E3DF",
    sidebarMuted: "#9DB5AF",
    sidebarActive: brand.white,
    sidebarHover: "rgb(255 255 255 / .05)",
    sidebarSelected: brand.green,
    tileGreenSoft: "#173A2B",
    tileGreen: "#4ADE80",
    tileAmberSoft: "#3A2E1C",
    tileAmber: "#FDBA74",
    tileBlueSoft: "#1A2F52",
    tileBlue: "#93C5FD",
    tilePinkSoft: "#3A1F3A",
    tilePink: "#F0ABFC",
  },
  shadow: {
    sm: "0 1px 2px rgb(16 42 34 / .04), 0 4px 14px rgb(16 42 34 / .05)",
    md: "0 2px 6px rgb(16 42 34 / .06), 0 8px 24px rgb(16 42 34 / .06)",
    lg: "0 12px 32px rgb(15 23 42 / .12), 0 2px 6px rgb(15 23 42 / .06)",
  },
  shadowDark: {
    sm: "0 1px 2px rgb(0 0 0 / .4)",
    md: "0 1px 3px rgb(0 0 0 / .45)",
    lg: "0 12px 32px rgb(0 0 0 / .55)",
  },
  /** A 4px grid. */
  space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 12: "48px" },
  /** Inputs and buttons 10px, cards 14px, dialogs 18px. */
  radius: { sm: "6px", md: "10px", lg: "14px", xl: "18px", pill: "999px" },
  font: {
    // The admin loads Inter and sets --we-font-inter; elsewhere a local Inter or the system face is used.
    family: 'var(--we-font-inter, Inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  },
  /** Page heading 24, section 18, component 16, body 14, secondary 13, metadata 12. */
  fontSize: { xs: "12px", sm: "13px", base: "14px", md: "16px", lg: "18px", xl: "24px" },
  fontWeight: { regular: "400", medium: "500", semibold: "600" },
  lineHeight: { tight: "1.25", snug: "1.4", normal: "1.5" },
  motion: { fast: "150ms", base: "200ms", ease: "cubic-bezier(.2, 0, 0, 1)" },
  size: { sidebar: "256px", topbar: "64px", control: "38px", controlSm: "32px", navItem: "44px", icon: "20px" },
  /**
   * Chart series in fixed order: navy-blue, green, violet. Each set passed the
   * dataviz palette validator against its mode's surface (lightness band,
   * chroma, colour-blind and normal-vision separation, contrast). The first
   * series is a more saturated step of the brand navy, which on its own reads
   * as grey. A fourth series folds into "Other".
   */
  // Green leads, as in the Commerce designs.
  chart: ["#16A34A", "#235E9C", "#8B5CF6"],
  chartDark: ["#1FAF55", "#5A93D8", "#9F7AEA"],
} as const;

type Scale = Readonly<Record<string, string>>;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function vars(prefix: string, scale: Scale): string {
  return Object.entries(scale)
    .map(([name, value]) => `--we-${prefix}${kebab(name)}:${value};`)
    .join("");
}

const chartVars = (series: readonly string[]) => series.map((value, i) => `--we-chart-${i + 1}:${value};`).join("");

/**
 * CSS custom properties for the token set, named by role (`--we-primary`,
 * `--we-surface`, `--we-text-secondary`, `--we-radius-lg`…). Dark mode
 * follows the operating system unless the page pins a theme with
 * `data-theme` on <html>, which the theme toggle sets.
 */
export function tokensCss(): string {
  const light =
    vars("", tokens.color) +
    vars("shadow-", tokens.shadow) +
    vars("space-", tokens.space) +
    vars("radius-", tokens.radius) +
    vars("font-size-", tokens.fontSize) +
    vars("font-weight-", tokens.fontWeight) +
    vars("line-height-", tokens.lineHeight) +
    vars("motion-", tokens.motion) +
    vars("size-", tokens.size) +
    chartVars(tokens.chart) +
    `--we-font-family:${tokens.font.family};--we-font-mono:${tokens.font.mono};`;
  const dark = vars("", tokens.colorDark) + vars("shadow-", tokens.shadowDark) + chartVars(tokens.chartDark);
  return [
    `:root{${light}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}color-scheme:dark;}}`,
    `:root[data-theme="dark"]{${dark}color-scheme:dark;}`,
  ].join("\n");
}

/**
 * Inline script for <head>: applies a saved theme before first paint so the
 * page never flashes the wrong one. Storage may be unavailable; then the OS
 * preference applies.
 */
export const THEME_STORAGE_KEY = "we-theme";
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
