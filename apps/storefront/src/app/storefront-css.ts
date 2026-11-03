import { ADMIN_CSS, BASE_CSS, tokensCss } from "@workeasy/ui";

/**
 * Storefront styles, prefixed `sf-`, on top of the shared WorkEasy360 tokens
 * and `c-` primitives (buttons, inputs, cards, badges). A shop wears its
 * merchant's brand, not WorkEasy360's: `.sf-root` maps the brand roles
 * (accent, primary, link, focus) to the colours chosen in Store Design,
 * which arrive as inline variables from themeCssVars. Platform pages outside
 * a shop (the home and not-found pages) keep the WorkEasy360 look.
 */
const STOREFRONT_CSS = `
body { background: var(--we-surface); }
.sf-root { font-family: var(--sf-font, inherit); font-size: 15px; color: var(--we-text-primary);
  --we-on-accent: var(--sf-on-accent, #fff); --we-on-primary: var(--sf-on-dark, #fff);
  --we-accent-hover: color-mix(in srgb, var(--we-accent) 88%, black); --we-accent-soft: color-mix(in srgb, var(--we-accent) 10%, var(--we-surface));
  --we-accent-strong: var(--we-accent); --we-link: var(--we-accent); --we-focus: var(--we-accent);
  --we-primary-hover: color-mix(in srgb, var(--we-primary) 88%, black);
  /* A light tint of the accent, for dots and highlights on the dark panels. */
  --sf-glow: color-mix(in srgb, var(--we-accent) 55%, white); }
/* The merchant's accent is checked against white, not against the dark theme, so in dark mode plain
   text links use the text colour and keep the accent as their underline. */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sf-root a:not([class]) { color: var(--we-text-primary); text-decoration-color: var(--we-accent); } }
:root[data-theme="dark"] .sf-root a:not([class]) { color: var(--we-text-primary); text-decoration-color: var(--we-accent); }
.sf-lang { padding: 8px 10px; border-radius: 12px; border: 1px solid var(--we-border-input); background: var(--we-surface); color: var(--we-text-primary); font: inherit; font-size: 14px; }
[dir="rtl"] .sf-hero::after { right: auto; left: -160px; }
[dir="rtl"] .sf-reviews blockquote { border-left: 0; border-right: 3px solid var(--we-accent); border-radius: 10px 0 0 10px; }
[dir="rtl"] .sf-hero .sf-btn svg { transform: scaleX(-1); }
/* Merchant text keeps its own direction: an English sentence in an Arabic shop reads left to right. */
.sf-hero p, .sf-banner p, .sf-richtext p, .sf-faq summary, .sf-faq p, .sf-quotes blockquote, .sf-announcement, .sf-desc, .sf-reviews p, .sf-footer-top p, .sf-content h1, .sf-content .c-rich > * { unicode-bidi: plaintext; }
.sf-logo { display: block; max-height: 40px; max-width: 180px; object-fit: contain; }
.sf-announcement { text-align: center; padding: 9px 16px; font-size: 14px; font-weight: 600; background: var(--we-primary); color: var(--sf-on-dark, #fff); }
.sf-announcement a { color: inherit; }
.sf-preview-bar { text-align: center; padding: 8px 16px; font-size: 13.5px; background: #FFF4D6; color: #5C3D00; }
.sf-preview-bar a { color: inherit; font-weight: 700; margin-inline-start: 8px; }
.sf-header { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--we-border);
  background: color-mix(in srgb, var(--we-surface) 92%, transparent); backdrop-filter: blur(8px); }
.sf-header-row { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 16px; padding: 0 20px; height: 68px; }
.sf-store-name { font-weight: 700; font-size: 19px; letter-spacing: -.02em; color: var(--we-text-primary); text-decoration: none; white-space: nowrap; }
.sf-nav { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.sf-nav a { padding: 8px 12px; border-radius: 999px; color: var(--we-text-body); text-decoration: none; font-weight: 500; font-size: 14.5px; white-space: nowrap; transition: background-color .15s, color .15s; }
.sf-nav a:hover, .sf-nav a[aria-current="page"] { color: var(--we-text-primary); background: var(--we-background); }
.sf-header-end { margin-inline-start: auto; display: flex; align-items: center; gap: 8px; }
.sf-search { position: relative; }
.sf-search input { width: 220px; padding-block: 9px; padding-inline: 36px 12px; border-radius: 999px; border: 1px solid var(--we-border-input); background: var(--we-background);
  color: var(--we-text-primary); font: inherit; font-size: 14.5px; }
.sf-search svg { position: absolute; inset-inline-start: 12px; top: 50%; transform: translateY(-50%); color: var(--we-text-secondary); }
.sf-icon-btn { position: relative; display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--we-border);
  background: var(--we-surface); color: var(--we-text-primary); cursor: pointer; text-decoration: none; }
.sf-count { position: absolute; top: -6px; inset-inline-end: -6px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  display: grid; place-items: center; color: var(--we-on-accent); background: var(--we-accent); box-shadow: 0 0 0 2px var(--we-surface); }
@media (max-width: 860px) { .sf-search { display: none; } .sf-header-row { gap: 10px; } .sf-nav-wrap { display: none; } }
.sf-subnav { display: none; border-top: 1px solid var(--we-border); padding: 6px 12px; }
@media (max-width: 860px) { .sf-subnav { display: block; } }

.sf-main { max-width: 1200px; margin: 0 auto; padding: 24px 20px 72px; }
.sf-hero { position: relative; overflow: hidden; border-radius: 24px; padding: 72px 56px; color: var(--sf-on-dark, #fff);
  background: radial-gradient(520px 320px at 88% 18%, color-mix(in srgb, var(--we-accent) 38%, transparent), transparent 70%),
    radial-gradient(420px 260px at 70% 110%, color-mix(in srgb, var(--we-accent) 18%, transparent), transparent 70%), var(--we-primary); }
.sf-hero-image { background-size: cover; background-position: center; }
.sf-hero-image::after { display: none; }
/* A faint dot grid on the right, fading out towards the text. */
.sf-hero::after { content: ""; position: absolute; right: -40px; top: 0; bottom: 0; width: 52%; opacity: .22; pointer-events: none;
  background-image: radial-gradient(circle, rgb(255 255 255 / .55) 1.2px, transparent 1.6px); background-size: 22px 22px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 60%); mask-image: linear-gradient(90deg, transparent, #000 60%); }
.sf-hero > * { position: relative; z-index: 1; max-width: 600px; }
/* Headings on dark panels take the panel's text colour, not the page heading colour. */
.sf-hero :is(h1, h2, h3), .sf-tile :is(h2, h3), .sf-toast :is(h2, h3) { color: inherit; }
.sf-hero h1 { margin: 16px 0 12px; font-size: clamp(34px, 5vw, 54px); font-weight: 700; letter-spacing: -.03em; line-height: 1.05; }
.sf-hero p { margin: 0 0 28px; color: color-mix(in srgb, var(--sf-on-dark, #fff) 80%, transparent); font-size: 17px; line-height: 1.55; }
.sf-pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 600;
  background: rgb(255 255 255 / .1); border: 1px solid rgb(255 255 255 / .16); color: #fff; }
.sf-pill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--sf-glow); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sf-glow) 30%, transparent); }
@media (max-width: 640px) {
  .sf-hero { padding: 44px 24px; border-radius: 20px; }
  .sf-hero::after { width: 70%; opacity: .14; }
}

.sf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 22px; border-radius: 14px; border: 0; font: inherit; font-weight: 600;
  font-size: 15.5px; cursor: pointer; text-decoration: none; color: var(--sf-on-accent, #fff); background: var(--we-accent); transition: background-color .15s, transform .15s, box-shadow .15s; }
.sf-btn { border-radius: var(--sf-button-radius, 14px); }
.sf-btn:hover { background: var(--we-accent-hover); }
.sf-btn:active { transform: translateY(1px); }
.sf-btn:disabled { opacity: .55; cursor: not-allowed; filter: none; }
.sf-btn-brand { background: var(--we-accent); }
.sf-btn-light { background: #fff; color: var(--we-primary); box-shadow: 0 6px 20px rgb(0 0 0 / .18); }
.sf-btn-light:hover { background: #fff; transform: translateY(-1px); }
.sf-btn-ghost { background: var(--we-background); color: var(--we-text-primary); border: 1px solid var(--we-border); }
.sf-btn-wa, .sf-btn-wa:hover { background: #1FA855; }
.sf-btn-tg, .sf-btn-tg:hover { background: #2AA3DF; }
.sf-btn-block { width: 100%; }

.sf-section { margin-top: 56px; }
.sf-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.sf-section-head h2 { font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -.02em; }
.sf-section-head a { font-weight: 600; font-size: 14.5px; text-decoration: none; }
.sf-section-head a:hover { text-decoration: underline; }
.sf-content { max-width: 760px; margin: 8px auto 48px; }
.sf-content h1 { font-size: clamp(28px, 4vw, 38px); line-height: 1.2; margin: 0 0 20px; }
.sf-page-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 20px; margin: 8px 0 22px; }
.sf-page-head h1 { margin: 0; font-size: clamp(26px, 4vw, 36px); letter-spacing: -.02em; }
.sf-page-head p { margin: 6px 0 0; color: var(--we-text-secondary); max-width: 64ch; }

.sf-grid { display: grid; gap: 28px 22px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
@media (max-width: 560px) { .sf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 14px; } }
.sf-card { display: grid; gap: 12px; align-content: start; color: inherit; text-decoration: none; }
.sf-card-img { position: relative; aspect-ratio: 1; border-radius: 16px; overflow: hidden; background: var(--we-background); border: 1px solid var(--we-border);
  transition: box-shadow .2s, transform .2s, border-color .2s; }
.sf-card:hover .sf-card-img { box-shadow: 0 12px 28px rgb(15 23 42 / .12); transform: translateY(-2px); border-color: var(--we-border-strong); }
.sf-card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform .35s ease; }
.sf-card:hover .sf-card-img img { transform: scale(1.04); }
.sf-card-img .c-badge, .sf-card-img .sf-sale { position: absolute; inset-inline-start: 10px; top: 10px; }
.sf-sale { display: inline-flex; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #B91C1C; color: #fff; }
.sf-card-body { display: grid; gap: 4px; }
.sf-card-title { font-weight: 600; font-size: 15px; line-height: 1.35; color: var(--we-text-primary); }
.sf-card:hover .sf-card-title { text-decoration: underline; text-underline-offset: 3px; }
.sf-price { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--we-text-primary); }
.sf-price s { color: var(--we-text-secondary); font-weight: 400; font-size: .9em; }
/* No photo: the product's initials on a soft tone. */
.sf-placeholder { width: 100%; height: 100%; display: grid; place-items: center; color: var(--we-text-secondary);
  background: radial-gradient(circle at 30% 25%, rgb(255 255 255 / .7), transparent 60%), var(--sf-tone, var(--we-surface-muted)); }
.sf-placeholder[data-tone="0"] { --sf-tone: #E7F3EC; --sf-ink: #166534; }
.sf-placeholder[data-tone="1"] { --sf-tone: #E6EDF3; --sf-ink: #1B3040; }
.sf-placeholder[data-tone="2"] { --sf-tone: #F6EEE1; --sf-ink: #8A4B12; }
.sf-placeholder[data-tone="3"] { --sf-tone: #EFEAF6; --sf-ink: #5B3B8C; }
.sf-initials { font-size: clamp(28px, 5vw, 44px); font-weight: 700; letter-spacing: .02em; color: var(--sf-ink, var(--we-text-secondary)); opacity: .85; }
.sf-line-img .sf-initials, .sf-reviewables .sf-initials { font-size: 20px; }
.sf-gallery-main .sf-initials { font-size: clamp(56px, 9vw, 96px); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sf-placeholder { --sf-tone: var(--we-surface-muted); --sf-ink: var(--we-text-secondary); background: var(--we-surface-muted); } }
:root[data-theme="dark"] .sf-placeholder { --sf-tone: var(--we-surface-muted); --sf-ink: var(--we-text-secondary); background: var(--we-surface-muted); }
@media (prefers-reduced-motion: reduce) { .sf-card-img, .sf-card-img img { transition: none; } .sf-card:hover .sf-card-img { transform: none; } }

.sf-tiles { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.sf-tile { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; min-height: 170px; padding: 20px; border-radius: 18px; overflow: hidden;
  color: #fff; text-decoration: none; background: var(--we-primary); transition: transform .2s, box-shadow .2s; }
.sf-tile:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgb(15 23 42 / .14); }
.sf-tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sf-tile::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 35%, rgb(0 0 0 / .55)); }
.sf-tile span, .sf-tile small { position: relative; z-index: 1; }
.sf-tile span { font-weight: 700; font-size: 20px; letter-spacing: -.01em; }
.sf-tile small { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; opacity: .9; }
/* Without an image: a light card in the accent's tint, with a large faint initial. */
.sf-tile-plain { color: var(--we-text-primary); border: 1px solid var(--we-border);
  background: radial-gradient(260px 160px at 100% 0%, color-mix(in srgb, var(--we-accent) 16%, transparent), transparent 70%), var(--we-accent-soft); }
.sf-tile-plain::after { display: none; }
.sf-tile-plain small { color: var(--we-accent); opacity: 1; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sf-tile-plain small { color: var(--sf-glow); } }
:root[data-theme="dark"] .sf-tile-plain small { color: var(--sf-glow); }
@media (prefers-reduced-motion: reduce) { .sf-tile { transition: none; } .sf-tile:hover { transform: none; } }

.sf-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sf-pager { display: flex; justify-content: center; gap: 8px; margin-top: 32px; }

.sf-product { display: grid; gap: 40px; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; }
@media (max-width: 860px) { .sf-product { grid-template-columns: minmax(0, 1fr); gap: 24px; } }
.sf-gallery { display: grid; gap: 12px; }
.sf-gallery-main { aspect-ratio: 1; max-height: 620px; border-radius: 20px; overflow: hidden; background: var(--we-background); border: 1px solid var(--we-border); }
.sf-gallery-main img, .sf-gallery-main video { width: 100%; height: 100%; object-fit: cover; }
.sf-thumbs { display: flex; gap: 10px; overflow-x: auto; }
.sf-thumbs button { flex: none; width: 76px; height: 76px; padding: 0; border-radius: 14px; overflow: hidden; border: 2px solid transparent; background: var(--we-background); cursor: pointer; }
.sf-thumbs button[aria-pressed="true"] { border-color: var(--we-accent); }
.sf-thumbs img { width: 100%; height: 100%; object-fit: cover; }
.sf-buy { position: sticky; top: 92px; display: grid; gap: 18px; }
.sf-buy h1 { margin: 0; font-size: clamp(26px, 3.5vw, 36px); letter-spacing: -.02em; line-height: 1.15; }
.sf-buy .sf-price { font-size: 24px; }
.sf-vendor { color: var(--we-text-secondary); font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: .06em; }
.sf-option { display: grid; gap: 8px; }
.sf-option-label { font-weight: 650; font-size: 14px; }
.sf-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.sf-chip { padding: 9px 14px; border-radius: 12px; border: 1px solid var(--we-border); background: var(--we-surface); color: var(--we-text-primary); font: inherit;
  font-size: 14.5px; font-weight: 600; cursor: pointer; }
.sf-chip[aria-pressed="true"] { border-color: var(--we-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--we-accent) 30%, transparent); color: var(--we-accent); }
.sf-chip[data-unavailable="true"] { color: var(--we-text-secondary); text-decoration: line-through; }
.sf-qty { display: inline-flex; align-items: center; border: 1px solid var(--we-border-input); border-radius: 12px; overflow: hidden; background: var(--we-surface); }
.sf-qty button { width: 40px; height: 44px; border: 0; background: transparent; font-size: 18px; cursor: pointer; color: var(--we-text-primary); }
.sf-qty button:disabled { opacity: .35; cursor: not-allowed; }
.sf-qty span { min-width: 34px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.sf-buy-row { display: flex; gap: 12px; align-items: center; }
.sf-buy-row .sf-btn { flex: 1; }
.sf-desc { white-space: pre-line; color: var(--we-text-primary); line-height: 1.65; }
.sf-facts { display: grid; gap: 10px; padding: 16px; border-radius: 16px; background: var(--we-background); font-size: 14px; }
.sf-facts div { display: flex; gap: 10px; align-items: center; }
.sf-facts svg { color: var(--we-accent); flex: none; }
.sf-stock { font-weight: 650; font-size: 14px; }
.sf-stock[data-tone="low"] { color: var(--we-warning-text); }
.sf-stock[data-tone="out"] { color: var(--we-error); }

.sf-two { display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr) 380px; align-items: start; }
@media (max-width: 900px) { .sf-two { grid-template-columns: minmax(0, 1fr); } }
.sf-summary { position: sticky; top: 92px; display: grid; gap: 14px; padding: 22px; border-radius: 20px; background: var(--we-background); border: 1px solid var(--we-border); }
.sf-summary h2 { margin: 0; font-size: 18px; }
.sf-sum-row { display: flex; justify-content: space-between; gap: 12px; font-size: 15px; font-variant-numeric: tabular-nums; }
.sf-sum-total { font-size: 19px; font-weight: 800; padding-top: 12px; border-top: 1px solid var(--we-border); }
.sf-lines { display: grid; }
.sf-line { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--we-border); align-items: start; }
.sf-line:first-child { padding-top: 0; }
.sf-line-img { text-decoration: none; width: 76px; height: 76px; border-radius: 14px; overflow: hidden; background: var(--we-background); border: 1px solid var(--we-border); }
.sf-line-img img { width: 100%; height: 100%; object-fit: cover; }
.sf-line-title { font-weight: 650; color: var(--we-text-primary); text-decoration: none; }
.sf-line-sub { color: var(--we-text-secondary); font-size: 13.5px; }
.sf-line-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.sf-link-btn { border: 0; background: none; padding: 0; color: var(--we-text-secondary); font: inherit; font-size: 13.5px; text-decoration: underline; cursor: pointer; }
.sf-mini-line { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 14px; }
.sf-mini-line .sf-line-img { width: 52px; height: 52px; border-radius: 10px; position: relative; overflow: visible; }
.sf-mini-line .sf-line-img img { border-radius: 10px; }
.sf-mini-qty { position: absolute; top: -7px; inset-inline-end: -7px; min-width: 20px; height: 20px; border-radius: 999px; background: var(--we-text-secondary); color: #fff;
  font-size: 11.5px; font-weight: 700; display: grid; place-items: center; padding: 0 5px; }

.sf-steps { display: grid; gap: 18px; }
.sf-step { padding: 22px; border-radius: 20px; border: 1px solid var(--we-border); background: var(--we-surface); display: grid; gap: 14px; }
.sf-step h2 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
.sf-step h2 span { width: 26px; height: 26px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 13px; color: var(--we-on-accent); background: var(--we-accent); }
.sf-choice { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border: 1px solid var(--we-border); border-radius: 14px; cursor: pointer; background: var(--we-surface); }
.sf-choice:has(input:checked) { border-color: var(--we-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-accent) 15%, transparent); }
.sf-choice input { margin-top: 3px; accent-color: var(--we-accent); width: 17px; height: 17px; }
.sf-choice strong { display: block; }
.sf-choice small { color: var(--we-text-secondary); font-size: 13.5px; }
.sf-choice-end { margin-inline-start: auto; font-weight: 700; white-space: nowrap; }

.sf-thanks { text-align: center; display: grid; gap: 10px; justify-items: center; padding: 8px 0 28px; }
.sf-thanks h1 { margin: 6px 0 0; font-size: clamp(26px, 4vw, 34px); letter-spacing: -.02em; }
.sf-thanks p { margin: 0; color: var(--we-text-secondary); max-width: 56ch; }
.sf-check { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: var(--we-on-accent); background: var(--we-accent); }
.sf-instructions { white-space: pre-line; padding: 16px; border-radius: 14px; background: var(--we-background); border: 1px dashed var(--we-border); font-size: 15px; }
.sf-btn-sm { padding: 8px 14px; border-radius: 10px; font-size: 14px; background: var(--we-background); color: var(--we-text-primary); border: 1px solid var(--we-border); }
.sf-code { display: flex; gap: 8px; }
.sf-code .c-input { flex: 1; min-width: 0; text-transform: uppercase; }
.sf-sum-save { color: var(--we-success-text); }
.sf-link { margin-inline-start: 8px; padding: 0; border: 0; background: none; color: var(--we-accent); font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
.sf-rates { border: 0; margin: 4px 0 0; padding: 0; display: grid; gap: 8px; }
.sf-slots-days { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.sf-slots-days button, .sf-slot { flex: none; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--we-border); background: var(--we-surface); color: var(--we-text-primary); font: inherit; font-size: 14px; cursor: pointer; text-align: center; }
.sf-slots-days button[aria-pressed="true"], .sf-slot[aria-pressed="true"] { border-color: var(--we-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-accent) 18%, transparent); font-weight: 700; }
.sf-slots-days small { display: block; color: var(--we-text-secondary); font-size: 12px; }
.sf-slot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
.sf-slot:disabled { opacity: 0.45; cursor: not-allowed; text-decoration: line-through; }
.sf-slot small { display: block; color: var(--we-text-secondary); font-size: 11.5px; }
.sf-stars { color: var(--we-rating); letter-spacing: 1px; white-space: nowrap; }
.sf-stars-empty { opacity: 0.25; }
.sf-star-input { border: 0; margin: 0; padding: 0; display: inline-flex; gap: 2px; }
.sf-star-input label { cursor: pointer; font-size: 28px; line-height: 1; color: var(--we-border); }
.sf-star-input label[data-on="true"] { color: var(--we-rating); }
.sf-star-input input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.sf-star-input label:has(input:focus-visible) { outline: 2px solid var(--we-accent); outline-offset: 2px; border-radius: 4px; }
.sf-review-form { display: grid; gap: 8px; }
.sf-review-form .sf-btn { justify-self: start; }
.sf-reviewables { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.sf-reviewables li { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 14px; align-items: start; padding-bottom: 16px; border-bottom: 1px solid var(--we-border); }
.sf-reviewables li:last-child { border-bottom: 0; padding-bottom: 0; }
.sf-reviews { margin-top: 40px; display: grid; gap: 12px; }
.sf-reviews-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.sf-reviews-head h2 { margin: 0; font-size: 22px; }
.sf-reviews ul { list-style: none; margin: 0; padding: 0; display: grid; }
.sf-reviews li { display: grid; gap: 6px; padding: 16px 0; border-top: 1px solid var(--we-border); }
.sf-reviews p { margin: 0; white-space: pre-line; }
.sf-reviews blockquote { margin: 4px 0 0; padding: 8px 12px; border-left: 3px solid var(--we-accent); background: var(--we-background); border-radius: 0 10px 10px 0; font-size: 14px; }
.sf-banner { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; overflow: hidden; border-radius: 24px; background: var(--we-background); border: 1px solid var(--we-border); }
.sf-banner:has(img) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.sf-banner img { width: 100%; height: 100%; min-height: 220px; object-fit: cover; }
.sf-banner > div { padding: 36px; display: grid; gap: 12px; align-content: center; justify-items: start; }
.sf-banner h2 { margin: 0; font-size: 28px; letter-spacing: -.02em; }
.sf-banner p { margin: 0; color: var(--we-text-secondary); }
@media (max-width: 720px) { .sf-banner:has(img) { grid-template-columns: 1fr; } }
.sf-quotes { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.sf-quotes figure { margin: 0; padding: 22px; border-radius: 18px; background: var(--we-background); border: 1px solid var(--we-border); display: grid; gap: 10px; }
.sf-quotes blockquote { margin: 0; font-size: 16px; }
.sf-quotes figcaption { color: var(--we-text-secondary); font-size: 14px; font-weight: 600; }
.sf-faq details { border-bottom: 1px solid var(--we-border); padding: 14px 0; }
.sf-faq summary { cursor: pointer; font-weight: 700; }
.sf-faq details p { margin: 8px 0 0; color: var(--we-text-secondary); }
.sf-richtext { max-width: 760px; }
.sf-richtext p { white-space: pre-line; color: var(--we-text-secondary); font-size: 16.5px; line-height: 1.6; }
.sf-footer-top { flex-wrap: wrap; align-items: flex-start; }
.sf-footer-top p { margin: 0; max-width: 520px; }
.sf-footer-top nav { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.sf-footer-top nav a { color: inherit; }
.sf-downloads { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.sf-downloads li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--we-border); border-radius: 14px; }
.sf-shipments { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.sf-shipments li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--we-border); border-radius: 14px; }
.sf-note { text-align: center; color: var(--we-text-secondary); margin: 24px auto 0; max-width: 52ch; }
.sf-empty { text-align: center; padding: 56px 20px; border-radius: 22px; background: var(--we-background); }
.sf-empty h2 { margin: 12px 0 6px; }
.sf-empty p { margin: 0 0 18px; color: var(--we-text-secondary); }
.sf-toast { position: fixed; z-index: 50; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; padding: 12px 14px 12px 18px;
  border-radius: 16px; background: var(--we-primary); color: #fff; box-shadow: 0 16px 40px rgb(15 23 42 / .3); max-width: calc(100vw - 32px); }
.sf-toast a { color: var(--sf-glow); font-weight: 700; white-space: nowrap; }

.sf-footer { border-top: 1px solid var(--we-border); margin-top: 56px; background: var(--we-background); }
.sf-footer-brand { max-width: 1200px; margin: 0 auto; padding: 32px 20px 0; }
.sf-footer-brand strong { font-size: 17px; font-weight: 700; color: var(--we-text-primary); letter-spacing: -.01em; }
.sf-footer-row { max-width: 1200px; margin: 0 auto; padding: 24px 20px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between;
  color: var(--we-text-secondary); font-size: 13.5px; }
.sf-powered { display: inline-flex; align-items: center; gap: 8px; color: var(--we-text-secondary); text-decoration: none; }
.sf-center { min-height: 70vh; display: grid; place-items: center; text-align: center; padding: 32px 20px; }
.sf-center h1 { margin: 16px 0 8px; font-size: 26px; }
.sf-center p { margin: 0; color: var(--we-text-secondary); }
`;

export const storefrontStyles = `${tokensCss()}\n${BASE_CSS}\n${ADMIN_CSS}\n${STOREFRONT_CSS}`;
