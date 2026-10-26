/**
 * Workeasy360 brand tokens, sampled from the logo: a deep navy "W", a ring
 * that runs from royal blue through teal to mint, and a mint dot. Every
 * surface in the admin and the storefront's defaults derive from these.
 *
 * Mint is a fill and highlight colour only: it is too light for text on
 * white, so success text uses a darker green.
 */
export const brand = {
  navy: "#071C45",
  blue: "#1257C6",
  teal: "#08A8B8",
  mint: "#05E3A0",
  gradient: "linear-gradient(135deg, #1257C6 0%, #08A8B8 55%, #05E3A0 100%)",
  gradientSoft: "linear-gradient(135deg, rgb(18 87 198 / .10) 0%, rgb(8 168 184 / .10) 55%, rgb(5 227 160 / .12) 100%)",
} as const;

export const tokens = {
  color: {
    background: "#FFFFFF",
    surface: "#F5F8FC",
    raised: "#FFFFFF",
    border: "#E2E8F1",
    text: "#0B1430",
    textMuted: "#51607A",
    accent: brand.blue,
    accentText: "#FFFFFF",
    teal: brand.teal,
    mint: brand.mint,
    navy: brand.navy,
    focus: brand.blue,
    success: "#08684C",
    warning: "#9A4410",
    danger: "#C62828",
    info: "#086A75",
    sidebar: brand.navy,
    sidebarText: "#C9D6F0",
    sidebarActive: "#FFFFFF",
  },
  colorDark: {
    background: "#0B1430",
    surface: "#0F1A36",
    raised: "#13213F",
    border: "#1E2A4A",
    text: "#EAF1FF",
    textMuted: "#9AA9C7",
    accent: "#6B98F0",
    accentText: "#0B1430",
    teal: "#2CC9D6",
    mint: "#34EBB4",
    // Lifted above the dark background so navy panels stay distinct.
    navy: "#122A5E",
    focus: "#7FA8F5",
    success: "#34EBB4",
    warning: "#FBBF24",
    danger: "#F87171",
    info: "#2CC9D6",
    sidebar: "#070F26",
    sidebarText: "#A9B8D8",
    sidebarActive: "#FFFFFF",
  },
  space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 12: "48px" },
  radius: { sm: "8px", md: "12px", lg: "16px", pill: "999px" },
  font: {
    family: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  },
  /**
   * Chart series in fixed order (blue, teal, amber), checked with the dataviz
   * palette validator against each mode's surface: lightness band, chroma,
   * colour-blind and normal-vision separation, contrast. Dark mode has its own
   * steps, not an automatic flip. A fourth series folds into "Other".
   */
  chart: ["#1257C6", "#008C99", "#B7791F"],
  chartDark: ["#5B8DEF", "#0E9E9A", "#C97A22"],
} as const;

type ColorTokens = { readonly [K in keyof typeof tokens.color]: string };

function colorVars(colors: ColorTokens): string {
  return Object.entries(colors)
    .map(([name, value]) => `--we-color-${name}:${value};`)
    .join("");
}

/**
 * CSS custom properties for the token set. Dark mode follows the operating
 * system unless the page pins a theme with `data-theme` on <html>, which the
 * theme toggle sets.
 */
export function tokensCss(): string {
  const space = Object.entries(tokens.space)
    .map(([step, value]) => `--we-space-${step}:${value};`)
    .join("");
  const radius = Object.entries(tokens.radius)
    .map(([name, value]) => `--we-radius-${name}:${value};`)
    .join("");
  const chart = tokens.chart.map((value, i) => `--we-chart-${i + 1}:${value};`).join("");
  const dark = colorVars(tokens.colorDark) + tokens.chartDark.map((value, i) => `--we-chart-${i + 1}:${value};`).join("");
  return [
    `:root{${colorVars(tokens.color)}${space}${radius}${chart}--we-gradient-brand:${brand.gradient};--we-gradient-soft:${brand.gradientSoft};` +
      `--we-font-family:${tokens.font.family};--we-font-mono:${tokens.font.mono};color-scheme:light;}`,
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
