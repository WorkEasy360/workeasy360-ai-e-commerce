import { tokensCss } from "./tokens";

/**
 * The admin's one shared style vocabulary (docs/01-design-system.md). Every module page is
 * built from these classes, prefixed `c-`, so all fourteen look and behave
 * alike: a navy sidebar and white top bar around a page that always opens
 * with a page header, then a toolbar, then cards, tables or forms.
 */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--we-font-family);font-size:15px;line-height:1.5;background:var(--we-color-surface);color:var(--we-color-text);
  -webkit-font-smoothing:antialiased}
:focus-visible{outline:2px solid var(--we-color-focus);outline-offset:2px}
a{color:var(--we-color-accent)}
h1,h2,h3,h4{line-height:1.25;letter-spacing:-.01em}
img,svg{max-width:100%}
`;

export const ADMIN_CSS = `
:root { --c-sidebar: 248px; --c-topbar: 60px;
  --c-shadow: 0 1px 2px rgb(7 28 69 / .05), 0 1px 3px rgb(7 28 69 / .08);
  --c-shadow-lg: 0 12px 32px rgb(7 28 69 / .14); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --c-shadow: 0 1px 3px rgb(0 0 0 / .5); --c-shadow-lg: 0 12px 32px rgb(0 0 0 / .55); } }
:root[data-theme="dark"] { --c-shadow: 0 1px 3px rgb(0 0 0 / .5); --c-shadow-lg: 0 12px 32px rgb(0 0 0 / .55); }

/* App shell ------------------------------------------------------------- */
.c-app { display: grid; grid-template-columns: var(--c-sidebar) minmax(0, 1fr); grid-template-rows: var(--c-topbar) 1fr; min-height: 100vh; }
.c-topbar { grid-column: 2; display: flex; align-items: center; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--we-color-border);
  background: var(--we-color-background); position: sticky; top: 0; z-index: 20; }
.c-topbar-start { display: flex; align-items: center; gap: 10px; min-width: 0; }
.c-topbar-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.c-sidebar { grid-row: 1 / -1; grid-column: 1; background: var(--we-color-sidebar); color: var(--we-color-sidebarText);
  position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; padding: 0 12px 16px; }
.c-sidebar-brand { display: flex; align-items: center; gap: 10px; height: var(--c-topbar); padding: 0 6px; color: #fff; text-decoration: none;
  font-weight: 700; font-size: 16px; letter-spacing: -.01em; flex: none; }
.c-sidebar-brand small { display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--we-color-mint); }
.c-nav-group { margin-top: 14px; }
.c-nav-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: rgb(201 214 240 / .72); margin: 0 10px 6px; }
.c-nav { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.c-nav a { position: relative; display: flex; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 10px; color: var(--we-color-sidebarText);
  text-decoration: none; font-size: 14.5px; font-weight: 500; }
.c-nav a:hover { background: rgb(255 255 255 / .06); color: #fff; }
.c-nav a[aria-current="page"] { background: rgb(255 255 255 / .09); color: var(--we-color-sidebarActive); font-weight: 600; }
.c-nav a[aria-current="page"]::before { content: ""; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--we-gradient-brand); }
.c-nav a[aria-current="page"] svg { color: var(--we-color-mint); }
.c-nav svg { flex: none; opacity: .95; }
.c-nav-tag { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: .04em; padding: 1px 7px; border-radius: 999px;
  background: var(--we-gradient-brand); color: #fff; }
.c-sidebar-foot { margin-top: auto; padding-top: 16px; }
.c-main { min-width: 0; grid-column: 2; }
.c-main:focus { outline: none; }
.c-skip { position: absolute; left: 8px; top: -48px; z-index: 100; padding: 8px 12px; border-radius: var(--we-radius-sm);
  background: var(--we-color-accent); color: var(--we-color-accentText); font-weight: 600; }
.c-skip:focus { top: 8px; }
.c-store-chip { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; font-size: 15px; }
.c-store-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-avatar { width: 30px; height: 30px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; font-size: 12px; font-weight: 700;
  color: #fff; background: var(--we-gradient-brand); }
.c-store-initial { width: 28px; height: 28px; border-radius: 8px; display: inline-grid; place-items: center; flex: none; font-size: 13px; font-weight: 800;
  color: var(--we-color-accent); background: color-mix(in srgb, var(--we-color-accent) 12%, transparent); }
.c-btn.c-menu-toggle { display: none; }
@media (max-width: 959px) {
  .c-app { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--c-topbar) 1fr; }
  .c-topbar, .c-main { grid-column: 1; }
  .c-topbar { padding: 0 16px; }
  .c-sidebar { position: fixed; inset: 0 auto 0 0; width: min(84vw, 300px); z-index: 40; transform: translateX(-100%); transition: transform .2s ease; }
  .c-app[data-nav-open="true"] .c-sidebar { transform: none; box-shadow: var(--c-shadow-lg); }
  .c-app[data-nav-open="true"]::after { content: ""; position: fixed; inset: 0; background: rgb(7 28 69 / .45); z-index: 30; }
  .c-btn.c-menu-toggle { display: inline-flex; }
  .c-hide-sm { display: none !important; }
}
@media (prefers-reduced-motion: reduce) { .c-sidebar { transition: none; } }

/* Page skeleton: header → toolbar → content --------------------------------- */
.c-page { max-width: 1200px; margin: 0 auto; padding: 28px 24px 48px; }
/* Narrow pages keep the same left edge as every other page; only their content is capped. */
.c-page-narrow > * { max-width: 880px; }
.c-page-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 16px; margin-bottom: 22px; }
.c-page-head h1 { font-size: 26px; margin: 0; font-weight: 700; }
.c-page-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--we-color-accent); margin-bottom: 6px; }
.c-subtitle { color: var(--we-color-textMuted); margin: 6px 0 0; max-width: 70ch; }
.c-page-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.c-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
.c-section { margin-top: 28px; }
.c-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.c-section-head h2 { font-size: 17px; margin: 0; }
@media (max-width: 959px) { .c-page { padding: 20px 16px 40px; } .c-page-head h1 { font-size: 22px; } }

/* Tabs ---------------------------------------------------------------------- */
.c-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--we-color-border); margin-bottom: 20px; }
.c-tabs a { padding: 10px 14px; color: var(--we-color-textMuted); text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 500; margin-bottom: -1px; }
.c-tabs a:hover { color: var(--we-color-text); }
.c-tabs a[aria-current="page"] { color: var(--we-color-accent); border-bottom-color: var(--we-color-accent); font-weight: 600; }

/* Buttons ------------------------------------------------------------------- */
.c-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; font: inherit; font-size: 14.5px; font-weight: 600;
  padding: 8px 14px; border-radius: 10px; border: 1px solid var(--we-color-border); background: var(--we-color-raised);
  color: var(--we-color-text); cursor: pointer; text-decoration: none; line-height: 1.3; white-space: nowrap; }
.c-btn:hover { background: var(--we-color-surface); }
.c-btn:disabled, .c-btn[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.c-btn-primary { background: var(--we-color-accent); border-color: var(--we-color-accent); color: var(--we-color-accentText); }
.c-btn-primary:hover { background: color-mix(in srgb, var(--we-color-accent) 88%, black); }
.c-btn-brand { background: var(--we-gradient-brand); border-color: transparent; color: #fff; }
.c-btn-brand:hover { filter: brightness(1.06); background: var(--we-gradient-brand); }
.c-btn-danger { color: var(--we-color-danger); border-color: color-mix(in srgb, var(--we-color-danger) 40%, var(--we-color-border)); }
.c-btn-ghost { border-color: transparent; background: transparent; }
.c-btn-ghost:hover { background: color-mix(in srgb, var(--we-color-text) 6%, transparent); }
.c-btn-sm { padding: 5px 10px; font-size: 13.5px; border-radius: 8px; }
.c-btn-icon { padding: 7px; }
.c-link-btn { font: inherit; padding: 0; border: 0; background: none; color: var(--we-color-accent); text-decoration: underline; cursor: pointer; }

/* Inputs -------------------------------------------------------------------- */
.c-form { display: grid; gap: 16px; }
.c-form-row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.c-field { display: grid; gap: 6px; align-content: start; }
.c-label { font-weight: 600; font-size: 13.5px; }
.c-label small { font-weight: 400; color: var(--we-color-textMuted); }
.c-hint { color: var(--we-color-textMuted); font-size: 13px; margin: 0; }
.c-input, .c-select, .c-textarea { font: inherit; font-size: 14.5px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--we-color-border);
  background: var(--we-color-raised); color: var(--we-color-text); width: 100%; }
.c-input:focus, .c-select:focus, .c-textarea:focus { outline: none; border-color: var(--we-color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-color-accent) 22%, transparent); }
.c-input[aria-invalid="true"] { border-color: var(--we-color-danger); }
.c-input-group { display: flex; align-items: stretch; border: 1px solid var(--we-color-border); border-radius: 10px; background: var(--we-color-raised); overflow: hidden; }
.c-input-group:focus-within { border-color: var(--we-color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-color-accent) 22%, transparent); }
.c-input-group > span { display: flex; align-items: center; padding: 0 10px; color: var(--we-color-textMuted); background: var(--we-color-surface);
  font-size: 13.5px; border-right: 1px solid var(--we-color-border); white-space: nowrap; }
.c-input-group .c-input { border: 0; border-radius: 0; box-shadow: none; min-width: 0; }
.c-search { position: relative; min-width: 200px; flex: 1 1 260px; max-width: 380px; }
.c-search svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--we-color-textMuted); pointer-events: none; }
.c-search .c-input { padding-left: 36px; }
.c-error { color: var(--we-color-danger); margin: 0; font-size: 13.5px; }
.c-ok { color: var(--we-color-success); margin: 0; font-size: 13.5px; }

/* Cards and grids ------------------------------------------------------------- */
.c-card { background: var(--we-color-raised); border: 1px solid var(--we-color-border); border-radius: var(--we-radius-lg); padding: 20px; box-shadow: var(--c-shadow); }
.c-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.c-card-head h2, .c-card-head h3 { font-size: 16px; margin: 0; }
.c-card-flush { padding: 0; overflow: hidden; }
.c-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.c-grid-2 { display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.c-grid-even { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 959px) { .c-grid-2, .c-grid-even { grid-template-columns: minmax(0, 1fr); } }
.c-stats { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.c-stat { display: grid; gap: 4px; }
.c-stat-label { display: flex; align-items: center; gap: 8px; color: var(--we-color-textMuted); font-size: 13.5px; font-weight: 500; }
.c-stat-value { font-size: 26px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.c-stat-foot { font-size: 12.5px; color: var(--we-color-textMuted); }
.c-icon-tile { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none;
  background: var(--we-gradient-soft); color: var(--we-color-accent); }
.c-icon-tile-lg { width: 56px; height: 56px; border-radius: 16px; }
.c-hero { position: relative; overflow: hidden; border-radius: var(--we-radius-lg); padding: 24px; color: #fff; background: var(--we-color-navy); }
.c-hero::before { content: ""; position: absolute; inset: auto -80px -140px auto; width: 360px; height: 360px; border-radius: 50%;
  border: 46px solid transparent; background: var(--we-gradient-brand) border-box;
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: .55; }
.c-hero > * { position: relative; }
.c-hero h2 { margin: 0 0 6px; font-size: 22px; }
.c-hero p { margin: 0; color: rgb(255 255 255 / .8); max-width: 60ch; }
.c-hero a:not(.c-btn) { color: var(--we-color-mint); }
.c-feature-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.c-feature-list li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.c-feature-list svg { flex: none; color: var(--we-color-teal); margin-top: 2px; }
.c-checklist { list-style: none; margin: 0; padding: 0; display: grid; }
.c-checklist li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--we-color-border); }
.c-checklist li:first-child { border-top: 0; }
.c-check { width: 24px; height: 24px; border-radius: 50%; flex: none; display: grid; place-items: center; border: 2px solid var(--we-color-border); color: transparent; }
.c-check[data-done="true"] { border-color: transparent; background: var(--we-gradient-brand); color: #fff; }
.c-checklist strong, .c-checklist .c-cell-title { display: block; font-size: 14.5px; }
.c-checklist span { color: var(--we-color-textMuted); font-size: 13px; }
.c-checklist .c-btn { margin-left: auto; }
.c-progress { height: 8px; border-radius: 999px; background: var(--we-color-surface); border: 1px solid var(--we-color-border); overflow: hidden; }
.c-progress > i { display: block; height: 100%; background: var(--we-gradient-brand); border-radius: inherit; }

/* Tables ---------------------------------------------------------------------- */
.c-table-wrap { position: relative; overflow-x: auto; border: 1px solid var(--we-color-border); border-radius: var(--we-radius-lg); background: var(--we-color-raised); box-shadow: var(--c-shadow); }
.c-table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.c-table th { text-align: left; font-size: 12.5px; font-weight: 600; color: var(--we-color-textMuted); background: var(--we-color-surface);
  padding: 10px 16px; border-bottom: 1px solid var(--we-color-border); white-space: nowrap; }
.c-table td { padding: 12px 16px; border-bottom: 1px solid var(--we-color-border); vertical-align: middle; }
.c-table tr:last-child td { border-bottom: 0; }
.c-table tbody tr:hover { background: color-mix(in srgb, var(--we-color-accent) 3%, transparent); }
.c-num, .c-table th.c-num { text-align: right; font-variant-numeric: tabular-nums; }
.c-cell-title { font-weight: 600; color: var(--we-color-text); text-decoration: none; }
.c-cell-sub { display: block; color: var(--we-color-textMuted); font-size: 12.5px; font-weight: 400; }
.c-mono { font-family: var(--we-font-mono); font-size: 12.5px; }
@media (max-width: 720px) {
  .c-table-stack thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .c-table-stack, .c-table-stack tbody, .c-table-stack tr, .c-table-stack td { display: block; width: 100%; }
  .c-table-stack tr { padding: 8px 0; border-bottom: 1px solid var(--we-color-border); }
  .c-table-stack td { border: 0; padding: 4px 16px; text-align: left; }
  .c-table-stack td[data-label]::before { content: attr(data-label) ": "; color: var(--we-color-textMuted); font-size: 12.5px; }
}

/* Badges ------------------------------------------------------------------------ */
.c-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px;
  background: var(--we-color-surface); color: var(--we-color-textMuted); border: 1px solid var(--we-color-border); white-space: nowrap; }
.c-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.c-badge[data-tone="success"] { color: var(--we-color-success); border-color: color-mix(in srgb, var(--we-color-success) 35%, transparent); background: color-mix(in srgb, var(--we-color-success) 10%, transparent); }
.c-badge[data-tone="warning"] { color: var(--we-color-warning); border-color: color-mix(in srgb, var(--we-color-warning) 35%, transparent); background: color-mix(in srgb, var(--we-color-warning) 10%, transparent); }
.c-badge[data-tone="danger"] { color: var(--we-color-danger); border-color: color-mix(in srgb, var(--we-color-danger) 35%, transparent); background: color-mix(in srgb, var(--we-color-danger) 10%, transparent); }
.c-badge[data-tone="info"] { color: var(--we-color-info); border-color: color-mix(in srgb, var(--we-color-info) 35%, transparent); background: color-mix(in srgb, var(--we-color-info) 10%, transparent); }
.c-badge[data-tone="brand"] { color: #fff; border-color: transparent; background: var(--we-gradient-brand); }
.c-badge[data-tone="brand"]::before { background: #fff; }

/* Menus (details/summary) -------------------------------------------------------- */
.c-menu { position: relative; display: inline-block; }
.c-menu > summary { list-style: none; }
.c-menu > summary::-webkit-details-marker { display: none; }
.c-menu-list { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; min-width: 220px; display: grid; padding: 6px;
  background: var(--we-color-raised); border: 1px solid var(--we-color-border); border-radius: 12px; box-shadow: var(--c-shadow-lg); }
.c-menu-list a, .c-menu-list button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
  cursor: pointer; font-size: 14px; color: var(--we-color-text); }
.c-menu-list a:hover, .c-menu-list button:hover, .c-menu-list a:focus-visible, .c-menu-list button:focus-visible { background: var(--we-color-surface); }
.c-menu-list hr { border: 0; border-top: 1px solid var(--we-color-border); margin: 4px 0; }
.c-menu-note { padding: 6px 10px; font-size: 12.5px; color: var(--we-color-textMuted); }

/* Segmented control --------------------------------------------------------------- */
.c-segmented { display: inline-flex; border: 1px solid var(--we-color-border); border-radius: 10px; overflow: hidden; background: var(--we-color-raised); }
.c-segmented button { font: inherit; font-size: 13.5px; padding: 7px 12px; border: 0; background: transparent; color: var(--we-color-textMuted); cursor: pointer; }
.c-segmented button + button { border-left: 1px solid var(--we-color-border); }
.c-segmented button[aria-pressed="true"] { background: color-mix(in srgb, var(--we-color-accent) 12%, transparent); color: var(--we-color-accent); font-weight: 600; }

/* Detail pages: main column and a sidebar of cards -------------------------------------- */
.c-detail { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; }
.c-detail-main, .c-detail-side { display: grid; gap: 16px; min-width: 0; }
@media (max-width: 1099px) { .c-detail { grid-template-columns: minmax(0, 1fr); } }
/* Content pages (About, policies): comfortable reading width and rhythm. */
.c-rich { max-width: 72ch; font-size: 16px; line-height: 1.7; overflow-wrap: anywhere; }
.c-rich > :first-child { margin-top: 0; }
.c-rich h2 { font-size: 22px; line-height: 1.3; margin: 1.6em 0 .5em; }
.c-rich h3 { font-size: 18px; line-height: 1.35; margin: 1.4em 0 .4em; }
.c-rich p, .c-rich ul, .c-rich ol { margin: 0 0 1em; }
.c-rich ul, .c-rich ol { padding-inline-start: 1.4em; }
.c-rich li + li { margin-top: .3em; }
.c-rich blockquote { margin: 0 0 1em; padding: 4px 0 4px 16px; border-inline-start: 3px solid var(--we-color-accent); color: var(--we-color-textMuted); }

/* A page's preview while editing: the same box the text area fills. */
.c-preview-pane { min-height: 380px; padding: 14px 16px; border: 1px solid var(--we-color-border); border-radius: 10px; background: var(--we-color-raised); }

/* A template to start from: a card-sized button with a title and a line of help. */
.c-template { display: grid; gap: 4px; text-align: start; font: inherit; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--we-color-border); background: var(--we-color-raised); color: var(--we-color-text); cursor: pointer; }
.c-template span { font-size: 13px; color: var(--we-color-textMuted); }
.c-template:hover:not(:disabled) { border-color: var(--we-color-accent); }
.c-template:disabled { opacity: .55; cursor: default; }

/* A titled group of fields inside a form, such as "Customer buys" in an offer. */
.c-fieldset { display: grid; gap: 10px; min-width: 0; margin: 12px 0; padding: 10px 14px 14px; border: 1px solid var(--we-color-border); border-radius: 12px; }
.c-fieldset > legend { padding: 0 6px; font-size: 13.5px; font-weight: 700; }

/* A collection rule: field, operator, value, remove. Two rows on phones. */
.c-rule-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) minmax(140px, 1.4fr) auto; gap: 8px; }
@media (max-width: 599px) { .c-rule-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .c-rule-row > :nth-child(3) { grid-column: 1 / 2; } }
.c-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--we-color-textMuted); text-decoration: none; margin-bottom: 8px; }
.c-back:hover { color: var(--we-color-accent); }
.c-savebar { position: sticky; bottom: 0; z-index: 15; margin: 24px -24px -48px; padding: 12px 24px; display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  background: color-mix(in srgb, var(--we-color-raised) 94%, transparent); backdrop-filter: blur(6px); border-top: 1px solid var(--we-color-border); }
.c-savebar .c-status { margin-right: auto; }
@media (max-width: 959px) { .c-savebar { margin: 20px -16px -40px; padding: 12px 16px; } }

/* Checkboxes, radios and choice rows ---------------------------------------------------------- */
.c-check-input { width: 17px; height: 17px; accent-color: var(--we-color-accent); flex: none; margin: 0; cursor: pointer; }
.c-radio-row { display: grid; gap: 8px; }
.c-radio-card { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--we-color-border); border-radius: 12px; cursor: pointer; background: var(--we-color-raised); }
.c-radio-card:has(input:checked) { border-color: var(--we-color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-color-accent) 15%, transparent); }
.c-radio-card strong { display: block; font-size: 14.5px; }
.c-radio-card span { color: var(--we-color-textMuted); font-size: 13px; }
.c-inline-check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }

/* Tag input --------------------------------------------------------------------------------------- */
.c-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 8px; border: 1px solid var(--we-color-border); border-radius: 10px; background: var(--we-color-raised); }
.c-tags:focus-within { border-color: var(--we-color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-color-accent) 22%, transparent); }
.c-tags input { border: 0; outline: 0; flex: 1 1 120px; min-width: 80px; font: inherit; font-size: 14px; padding: 4px; background: transparent; color: var(--we-color-text); }
.c-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 600;
  background: color-mix(in srgb, var(--we-color-accent) 10%, transparent); color: var(--we-color-accent); }
.c-tag button { all: unset; cursor: pointer; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; }
.c-tag button:hover, .c-tag button:focus-visible { background: color-mix(in srgb, var(--we-color-accent) 18%, transparent); }

/* Thumbnails and the media grid -------------------------------------------------------------------- */
.c-thumb { width: 44px; height: 44px; border-radius: 10px; flex: none; object-fit: cover; background: var(--we-gradient-soft); border: 1px solid var(--we-color-border);
  display: grid; place-items: center; color: var(--we-color-accent); overflow: hidden; }
.c-thumb-sm { width: 36px; height: 36px; border-radius: 8px; }
.c-thumb-lg { width: 100%; height: auto; aspect-ratio: 1; border-radius: 12px; }
.c-media-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.c-media-card { position: relative; display: grid; gap: 6px; padding: 8px; border: 1px solid var(--we-color-border); border-radius: 14px; background: var(--we-color-raised);
  text-align: left; font: inherit; color: inherit; cursor: pointer; }
.c-media-card:hover { border-color: color-mix(in srgb, var(--we-color-accent) 45%, var(--we-color-border)); }
.c-media-card[aria-pressed="true"], .c-media-card[aria-current="true"] { border-color: var(--we-color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-color-accent) 18%, transparent); }
.c-media-card .c-thumb-lg { border: 0; }
.c-media-card small { color: var(--we-color-textMuted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-media-card strong { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-media-card .c-badge { position: absolute; top: 14px; left: 14px; }
.c-media-strip { display: flex; flex-wrap: wrap; gap: 10px; }
.c-media-strip .c-media-card { width: 112px; cursor: default; }
.c-media-strip .c-thumb-lg { aspect-ratio: 1; }
.c-media-tools { display: flex; gap: 2px; justify-content: center; }
.c-dropzone { display: grid; place-items: center; gap: 6px; text-align: center; padding: 22px; border: 2px dashed var(--we-color-border); border-radius: 14px;
  background: var(--we-color-surface); color: var(--we-color-textMuted); font-size: 14px; cursor: pointer; }
.c-dropzone[data-over="true"] { border-color: var(--we-color-accent); background: color-mix(in srgb, var(--we-color-accent) 6%, var(--we-color-surface)); }
.c-dropzone strong { color: var(--we-color-text); }

/* Bulk actions bar ---------------------------------------------------------------------------------- */
.c-bulkbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border-radius: 12px;
  background: var(--we-color-navy); color: #fff; }
.c-bulkbar strong { margin-right: auto; font-size: 14px; }
.c-bulkbar .c-btn { background: rgb(255 255 255 / .1); border-color: rgb(255 255 255 / .18); color: #fff; }
.c-bulkbar .c-btn:hover { background: rgb(255 255 255 / .18); }

/* Compact inputs inside tables (variant matrix, inventory) ------------------------------------------- */
.c-table .c-input, .c-table .c-select { padding: 6px 8px; font-size: 14px; min-width: 84px; }
.c-table-compact td { padding: 8px 10px; }
.c-table-compact th { padding: 8px 10px; }
.c-table tr[data-clickable] { cursor: pointer; }
.c-delta-pos { color: var(--we-color-success); font-weight: 600; }
.c-delta-neg { color: var(--we-color-danger); font-weight: 600; }
.c-option-row { display: grid; grid-template-columns: minmax(120px, 200px) minmax(0, 1fr) auto; gap: 10px; align-items: start; }
@media (max-width: 640px) { .c-option-row { grid-template-columns: minmax(0, 1fr); } }

/* Dialogs and drawers (native <dialog>) ---------------------------------------------------------------- */
.c-dialog { border: 0; padding: 0; border-radius: 18px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); color: var(--we-color-text);
  background: var(--we-color-raised); box-shadow: var(--c-shadow-lg); }
.c-dialog-wide { width: min(920px, calc(100vw - 32px)); }
.c-dialog::backdrop { background: rgb(7 28 69 / .5); backdrop-filter: blur(2px); }
.c-dialog[open] { display: flex; flex-direction: column; }
.c-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; border-bottom: 1px solid var(--we-color-border); }
.c-dialog-head h2 { margin: 0; font-size: 17px; }
.c-dialog-body { padding: 16px 20px; overflow-y: auto; display: grid; gap: 14px; align-content: start; }
.c-dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--we-color-border); }
.c-drawer { margin: 0 0 0 auto; height: 100vh; max-height: 100vh; border-radius: 0; width: min(440px, 100vw); }
.c-pager { display: flex; justify-content: center; margin-top: 16px; }

/* Payment providers ------------------------------------------------------------------------------- */
.c-page > .c-card + .c-card { margin-top: 20px; }
/* Domains -------------------------------------------------------------------------------------- */
.c-dns { display: grid; gap: 6px; padding: 12px 14px; border-radius: 12px; background: var(--we-color-surface); border: 1px solid var(--we-color-border); }
.c-dns-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.c-dns-row .c-label { margin: 0; font-size: 12.5px; color: var(--we-color-textMuted); }
.c-dns-value { font-family: var(--we-font-mono); font-size: 13px; overflow-wrap: anywhere; }

/* AI Studio ------------------------------------------------------------------------------------ */
.c-ai-output { display: grid; gap: 14px; }
.c-ai-text { margin: 4px 0 0; white-space: pre-line; line-height: 1.6; }
.c-ai-serp { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--we-color-surface); margin-top: 4px; }
.c-ai-serp strong { color: var(--we-color-accent); font-weight: 600; }
.c-ai-serp span { font-size: 13.5px; color: var(--we-color-textMuted); }
.c-ai-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 14px; }
.c-ai-insights { margin: 0; padding-left: 20px; display: grid; gap: 10px; }
.c-ai-insights li { display: grid; gap: 2px; }
.c-ai-insights span { color: var(--we-color-textMuted); font-size: 14px; }

/* Store Design --------------------------------------------------------------------------------- */
.c-design { display: grid; gap: 16px; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); align-items: start; }
@media (max-width: 1100px) { .c-design { grid-template-columns: minmax(0, 1fr); } }
.c-design-panel { display: grid; gap: 12px; align-content: start; }
.c-design-section { border: 1px solid var(--we-color-border); border-radius: 12px; background: var(--we-color-raised); padding: 6px 8px 6px 12px; }
.c-design-section[data-open="true"] { padding-bottom: 14px; box-shadow: var(--c-shadow); }
.c-design-section-head { display: flex; align-items: center; gap: 6px; }
.c-design-section-head > span { margin-left: auto; display: inline-flex; }
.c-design-toggle { flex: 1; min-width: 0; display: grid; text-align: left; gap: 1px; padding: 6px 0; border: 0; background: none; font: inherit; color: var(--we-color-text); cursor: pointer; }
.c-design-toggle .c-muted { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-design-item { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 8px; border-radius: 10px; background: var(--we-color-surface); }
.c-design-item .c-textarea { grid-column: 1; }
.c-design-item button { grid-column: 2; grid-row: 1 / span 2; align-self: start; }
.c-design-chip { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; font-weight: 800; border: 1px solid var(--we-color-border); }
.c-design-frame { background: var(--we-color-surface); padding: 14px; border-radius: 0 0 var(--we-radius-lg) var(--we-radius-lg); display: grid; justify-items: center; }
.c-design-frame iframe { width: 100%; height: 760px; border: 1px solid var(--we-color-border); border-radius: 12px; background: #fff; }
.c-design-frame[data-device="mobile"] iframe { width: 390px; max-width: 100%; height: 760px; border-radius: 28px; border-width: 8px; border-color: #0B1430; }

/* Charts --------------------------------------------------------------------------------------- */
.c-chart { margin: 0; position: relative; }
.c-chart-plot { position: relative; }
.c-chart svg { display: block; width: 100%; height: auto; overflow: visible; touch-action: pan-y; }
.c-chart svg:focus-visible { outline: 2px solid var(--we-color-accent); outline-offset: 4px; border-radius: 8px; }
.c-chart-grid { stroke: var(--we-color-border); stroke-width: 1; vector-effect: non-scaling-stroke; }
.c-chart-axis { fill: var(--we-color-textMuted); font-size: 11px; font-variant-numeric: tabular-nums; }
.c-chart-cross { stroke: var(--we-color-textMuted); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.c-chart-dot { stroke: var(--we-color-raised); stroke-width: 2; }
.c-chart-tip { position: absolute; top: 0; transform: translateX(-50%); pointer-events: none; display: grid; gap: 2px; padding: 6px 10px; border-radius: 8px;
  background: var(--we-color-raised); border: 1px solid var(--we-color-border); box-shadow: var(--c-shadow); font-size: 12.5px; white-space: nowrap; color: var(--we-color-text); }
.c-chart-tip span { color: var(--we-color-textMuted); }
.c-chart-toggle { margin-top: 6px; padding: 0; border: 0; background: none; color: var(--we-color-accent); font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: underline; }
.c-barlist, .c-funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.c-barlist-text { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; margin-bottom: 4px; }
.c-barlist-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-barlist-text strong { font-variant-numeric: tabular-nums; }
.c-barlist-track { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--we-color-border) 55%, transparent); overflow: hidden; }
.c-barlist-track i { display: block; height: 100%; border-radius: 4px; }
.c-delta { font-size: 12.5px; color: var(--we-color-textMuted); }
.c-delta[data-tone="up"]::first-letter, .c-delta[data-tone="down"]::first-letter { font-weight: 700; }
.c-range { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: color-mix(in srgb, var(--we-color-border) 50%, transparent); }
.c-range button { border: 0; background: none; padding: 6px 12px; border-radius: 8px; font: inherit; font-size: 13.5px; color: var(--we-color-textMuted); cursor: pointer; }
.c-range button[aria-pressed="true"] { background: var(--we-color-raised); color: var(--we-color-text); font-weight: 600; box-shadow: 0 1px 2px rgba(7, 28, 69, 0.08); }
.c-stars { color: var(--we-chart-3); letter-spacing: 1px; white-space: nowrap; }
.c-review { display: grid; gap: 6px; padding: 16px 0; border-bottom: 1px solid var(--we-color-border); }
.c-review:last-child { border-bottom: 0; }
.c-review-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.c-review-head > :last-child { margin-left: auto; display: inline-flex; gap: 6px; }
.c-review blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--we-color-accent); background: color-mix(in srgb, var(--we-color-accent) 6%, transparent); border-radius: 0 8px 8px 0; font-size: 14px; }

.c-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.03em; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--we-color-accent) 10%, transparent); color: var(--we-color-accent); }
.c-zone + .c-zone { margin-top: 16px; }
.c-zone-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.c-zone-head > :last-child { margin-left: auto; display: inline-flex; gap: 6px; }
.c-rate-row { display: grid; grid-template-columns: minmax(140px, 2fr) minmax(110px, 1.2fr) repeat(2, minmax(80px, 1fr)) minmax(90px, 1fr) minmax(90px, 1fr) minmax(110px, 1.4fr) auto; gap: 8px; align-items: end; }
@media (max-width: 959px) { .c-rate-row { grid-template-columns: 1fr 1fr; padding-bottom: 12px; border-bottom: 1px solid var(--we-color-border); } }
.c-hours { display: grid; gap: 8px; }
.c-hours-day { display: grid; grid-template-columns: 56px 1fr; gap: 10px; align-items: center; }
.c-hours-day > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.c-hours-day .c-input { width: 108px; padding: 6px 8px; }

.c-provider-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-bottom: 12px; }
.c-provider { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--we-color-border); border-radius: var(--we-radius-md, 12px); background: var(--we-color-surface); }
.c-provider-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.c-provider-head > :last-child { margin-left: auto; }
.c-provider-logo { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #fff; background: var(--we-gradient-brand); }
.c-kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 14px; }
.c-kv dt { color: var(--we-color-textMuted); }
.c-kv dd { margin: 0; overflow-wrap: anywhere; }

/* Empty, loading and status states --------------------------------------------------- */
.c-empty { text-align: center; padding: 48px 24px; border: 1px dashed var(--we-color-border); border-radius: var(--we-radius-lg); background: var(--we-color-raised); }
.c-empty .c-icon-tile { margin: 0 auto; }
.c-empty h2 { font-size: 18px; margin: 14px 0 6px; }
.c-empty p { color: var(--we-color-textMuted); margin: 0 auto 18px; max-width: 52ch; }
.c-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.c-status { min-height: 1.5em; margin: 0; font-size: 13.5px; }
.c-skeleton { height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--we-color-surface), var(--we-color-border), var(--we-color-surface));
  background-size: 200% 100%; animation: c-shimmer 1.2s infinite; }
@keyframes c-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .c-skeleton { animation: none; } }
.c-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.c-muted { color: var(--we-color-textMuted); }
.c-center-page { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px;
  background: radial-gradient(1200px 600px at 100% 0%, rgb(5 227 160 / .10), transparent 60%), radial-gradient(900px 500px at 0% 100%, rgb(18 87 198 / .10), transparent 60%), var(--we-color-surface); }
.c-auth { width: min(100%, 460px); display: grid; gap: 20px; }
.c-auth-brand { display: flex; align-items: center; gap: 12px; justify-content: center; }
.c-auth-brand strong { font-size: 20px; letter-spacing: -.01em; }
.c-auth-brand small { display: block; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--we-color-teal); }
`;

/** Everything the admin's root layout puts in its one <style> tag. */
export function adminStyles(): string {
  return `${tokensCss()}\n${BASE_CSS}\n${ADMIN_CSS}`;
}
