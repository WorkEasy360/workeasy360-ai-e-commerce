# 01 · Design system

This product uses the **WorkEasy360 design system**, which is shared by every product in the suite (CRM, HRMS, Helpdesk, AI Agent Platform, AI Form Builder, Commerce). Products have their own navigation and screens, but they all use the same colours, type, spacing, components and interaction rules.

Tokens are defined once, in `packages/ui/src/tokens.ts`, and published as CSS custom properties named by role. Components are the `c-*` classes in `packages/ui/src/admin-css.ts`, and they read only tokens. Never hardcode a colour, size or radius in a page; if a token is missing, add it.

## Name and logo

- Inside the product the name is **WorkEasy Commerce** (`PRODUCT_NAME` in `packages/ui/src/components/logo.tsx`). The sidebar and sign-in page show the "WorkEasy360" wordmark (`Wordmark`, with "360" in green) above a green **Commerce** badge (`.c-brand-badge`), as in the Commerce designs of November 2026.
- The logo artwork is `packages/ui/assets/logo.jpg`. `BrandMark` and the `icon.svg` favicons draw a vector traced from it, in the logo green `#00BF62` (`brand.logo`). That green is used for the mark only, never for UI.
- Technical identifiers keep the old `workeasy360` spelling so nothing that already exists breaks: the custom-domain TXT record `_workeasy360.<domain>`, the database ownership mark, email message IDs and package names.

## Colour

The Commerce look (November 2026 designs) is **white cards on a pale green-grey canvas, a deep teal sidebar, and green for actions and the current page**. Figures sit beside coloured icon tiles: green for orders, amber for money, blue for people, pink for products (`--we-tile-*`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--we-primary` | `#1B3040` navy | `#27455A` | Navigation, headings, high-emphasis structure (bulk bar, hero, badges) |
| `--we-primary-hover` | `#112532` | `#315770` | Hover on navy fills |
| `--we-accent` | `#15803D` green | `#4ADE80` | Primary buttons, the selected filter pill, ticks, links |
| `--we-accent-hover` | `#166534` | `#22C55E` | Hover on green fills |
| `--we-on-accent` | `#FFFFFF` | `#112532` | Text on green: white on `#15803D` is 5:1 |
| `--we-accent-bright` | `#22C55E` | `#22C55E` | Fills without text only: progress bars, chart lines |
| `--we-accent-soft` / `--we-accent-strong` | `#DCFCE7` / `#166534` | | Pale green background / green text |
| `--we-background` | `#F4F7F5` | `#0B1620` | Application canvas |
| `--we-surface` | `#FFFFFF` | `#112532` | Cards, top bar, inputs, menus, dialogs |
| `--we-surface-muted` | `#F1F5F9` | `#16303F` | Hover, selected rows, tags, segmented tracks |
| `--we-border` / `--we-border-strong` | `#E2E8F0` / `#CBD5E1` | `#27455A` / `#36576E` | Card and table lines / button outlines and dashed edges |
| `--we-border-input` | `#7D8BA0` | `#5A7A91` | Text field outlines: at least 3:1 against every surface they sit on (WCAG 1.4.11) |
| `--we-text-primary` | `#1B3040` | `#F1F5F9` | Headings, titles, values |
| `--we-text-body` | `#334155` | `#CBD5E1` | Body text |
| `--we-text-secondary` | `#5B6B7E` | `#94A3B8` | Hints, labels, metadata (5:1 on the canvas and pale greens) |
| `--we-link` | `#15803D` | `#4ADE80` | Text links, always underlined |
| `--we-focus` | `#15803D` | `#4ADE80` | Focus rings |
| `--we-sidebar` / `--we-sidebar-selected` | `#0F2B2F` / `#15803D` | `#0A2125` / `#15803D` | The deep teal sidebar and its green current-page pill |

**Never put white text on the bright green** (`#22C55E`, 2.3:1): it is for fills without text. The action green `#15803D` carries white text and reads as green text on white (both 5:1). Secondary text passes AA on white, the canvas, `--we-surface-muted` and the pale greens.

### Status colours

Each status has three steps:
- **base**, for icons, dots and borders
- **`-soft`**, a pale background
- **`-text`**, a dark foreground that passes AA on the soft background (6.4–7.6:1)

Badges and alerts always pair the colour with a label and a dot, so status never depends on colour alone.

| Status | Base | Soft | Text |
|---|---|---|---|
| success | `#16A34A` | `#DCFCE7` | `#166534` |
| info | `#2563EB` | `#DBEAFE` | `#1E40AF` |
| warning | `#D97706` | `#FEF3C7` | `#92400E` |
| error | `#DC2626` | `#FEE2E2` | `#991B1B` |
| ai | `#7C3AED` | `#EDE9FE` | `#5B21B6` |

`--we-rating` (`#B45309`) is used for star ratings only.

### Charts

- Charts sit on white surfaces with `--we-border` grid lines and secondary-text axes.
- Series take `--we-chart-1…3` in a fixed order:

  | Mode | Navy-blue | Green | Violet |
  |---|---|---|---|
  | Light | `#235E9C` | `#16A34A` | `#8B5CF6` |
  | Dark | `#5A93D8` | `#1FAF55` | `#9F7AEA` |

- Both sets pass the dataviz palette validator: lightness band, chroma, colour-blind and normal-vision separation, and 3:1 contrast. Brand navy is too grey to separate as a series, so series 1 is a more saturated navy-blue.
- Green and amber are hard to tell apart for colour-blind users, so amber is kept for ratings and is not a series colour.
- A fourth series folds into "Other".
- Text in charts uses text tokens, never the series colour.

### Dark mode

Dark mode follows the operating system until someone chooses with the theme toggle. The choice is saved per browser and applied before first paint. Dark values are their own steps, not an automatic inversion.

## Type, spacing and shape

- **Font:** Inter, self-hosted by `next/font` in the admin. Numbers in tables, stats and charts use tabular numerals.
- **Type scale** (`--we-font-size-*`): page heading 24/600 (`xl`), section heading 18/600 (`lg`), component heading 16/600 (`md`), body 14/400 (`base`), secondary 13 (`sm`), metadata 12 (`xs`). Weights are 400, 500 and 600 only.
- **Spacing:** a 4px grid (`--we-space-1…12`: 4, 8, 12, 16, 20, 24, 32, 48).
- **Radii:**
  - `--we-radius-sm` 6px: tags and small chips
  - `--we-radius-md` 8px: inputs, buttons, menu items
  - `--we-radius-lg` 12px: cards, tables, popovers
  - `--we-radius-xl` 16px: dialogs
- **Shadows:** `--we-shadow-sm` for cards and `--we-shadow-md` for tooltips, both nearly flat. `--we-shadow-lg` is for floating layers only (menus, dialogs, the mobile drawer).
- **Sizes:**
  - sidebar 248px
  - top bar 56px
  - controls 36px (small 30px)
  - nav items 36px
  - icons 18px
- **Motion:** 150ms for hover and focus changes, 200ms for the drawer, both using `--we-motion-ease`. Transitions and animations are removed under `prefers-reduced-motion`.

## Components

| Component | Classes | Notes |
|---|---|---|
| Buttons | `c-btn` (secondary), `c-btn-primary` (green), `c-btn-dark` (navy), `c-btn-danger`, `c-btn-ghost`, `c-btn-sm`, `c-btn-icon` | One primary button per view. Disabled at 50% |
| Inputs | `c-input`, `c-select`, `c-textarea`, `c-input-group`, `c-tags`, `c-search` | Navy focus border plus ring; `aria-invalid` turns them red |
| Choices | `c-check-input`, `c-radio-card`, `c-segmented`, `c-range` | |
| Navigation | `c-nav`, `c-tabs`, `c-back`, `c-pager` | Active means navy text plus a green indicator |
| Content | `c-card`, `c-stat`, `c-table`, `c-kv`, `c-checklist`, `c-feature-list` | Tables stack into labelled rows on phones (`c-table-stack`) |
| Status | `c-badge[data-tone]`, `c-alert[data-tone]`, `c-progress`, `c-skeleton`, `c-empty` | Tones: success, warning, danger, info, brand, ai |
| Floating | `c-menu`, `c-listbox`, `c-dialog`, `c-drawer`, `c-chart-tip`, `c-fab`, `c-chatbox` | `c-fab` is the assistant launcher fixed to the bottom-right corner. `c-chatbox` is its chat window (full screen on phones) |
| Charts | `c-chart`, `c-barlist`, `c-funnel` (in `apps/admin/src/components/charts.tsx`) | |

## Application shell

All WorkEasy360 products share this shell; only the navigation items differ.

- **Sidebar** (deep teal, 256px): the WorkEasy360 wordmark, the green Commerce badge, the eight sections (below) and, at the foot, a "Your store is live!" card with the store's address and View Store. The current section is a solid green pill; Orders shows how many orders wait to be fulfilled.
- **Top bar** (white, 64px):
  - Left: the store switcher and search. Search jumps to any module or page the role can open; press `/` or Ctrl+K to focus it.
  - Right: notifications, the theme toggle and the signed-in person with their role. The AI assistant opens from its floating button in the bottom-right corner.
- **Section tabs:** a section with several pages (Catalog, Storefront, Marketing) shows them as pill tabs above the page.
- **Phones** (under 960px): the sidebar becomes a drawer, and a bottom tab bar shows Home, Orders, Products, Store and More (which opens the drawer). Under 600px the top bar shows a compact WorkEasy360 Commerce logo instead of the store switcher; switching stores is in the account menu. Tables marked `.c-table-stack` become one card per row.
- **Notifications** list what needs attention, using the counts the module pages already show: unpaid and unfulfilled orders, reviews to moderate, and low or out-of-stock items. Each role sees only what it can act on.

## The page contract

Every admin page has the same skeleton, built from `@workeasy/ui/react`:

1. `<Page>`: centred container, 1200px wide. A `narrow` page keeps the same left edge and caps its content at 880px.
2. `<PageHeader eyebrow title subtitle actions>`. The primary action sits at the right edge.
3. An optional `.c-toolbar` (search, filters) or `.c-tabs`.
4. Content: `<Card>`, `.c-stats` with `<StatCard>`, `.c-table-wrap` tables, `.c-form` forms.
5. Before there is data: `<EmptyState icon title actions>`.

The modules are declared once, in `apps/admin/src/lib/modules.tsx`, with their label, path, group, icon, permission, summary, primary action and feature list, and grouped into the eight sidebar sections (`SECTIONS`). The sidebar, the section tabs, the search and each module page all read from those lists, so a module's name or icon can't drift between places.

## Sidebar groups

The merchant menu from the development note (v2, section 2), as eight sections:

- **Home:** the dashboard
- **Orders**
- **Catalog:** Products, Collections, Inventory (Media Library and AI Studio open from the editors)
- **Customers**
- **Storefront:** Design, Pages
- **Marketing:** Offers, Reviews
- **Reports**
- **Settings:** General, Checkout, Delivery & pickup, Payments & tax, Staff, Domain, Audit log

The sidebar shows only the sections the user's role can open, each linking to its first page they may see. The API enforces the same permissions on every request.

## Storefronts

A shop belongs to its merchant, so it wears the merchant's brand rather than WorkEasy360's:

- Store Design sets the accent and dark colours.
- `.sf-root` (in `apps/storefront/src/app/storefront-css.ts`) maps the brand roles (`--we-accent`, `--we-primary`, `--we-link`, `--we-focus`) to those colours.
- The shop keeps its own decorative defaults (`--sf-*`).

Shops still share the neutral tokens and `c-*` primitives. Platform pages outside a shop, such as the storefront home and "not found" pages, use the WorkEasy360 look.
