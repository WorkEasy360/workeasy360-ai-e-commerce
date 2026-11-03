# 01 · Design system

This product uses the **WorkEasy360 design system**, which is shared by every product in the suite (CRM, HRMS, Helpdesk, AI Agent Platform, AI Form Builder, Commerce). Products have their own navigation and screens, but they all use the same colours, type, spacing, components and interaction rules.

Tokens are defined once, in `packages/ui/src/tokens.ts`, and published as CSS custom properties named by role. Components are the `c-*` classes in `packages/ui/src/admin-css.ts`, and they read only tokens. Never hardcode a colour, size or radius in a page; if a token is missing, add it.

## Name and logo

- Inside the product the name is **Workeasy AI Commerce** (`PRODUCT_NAME` in `packages/ui/src/components/logo.tsx`). Lockups show "Workeasy" with "AI Commerce" beneath it.
- The logo artwork is `packages/ui/assets/logo.jpg`. `BrandMark` and the `icon.svg` favicons draw a vector traced from it, in the logo green `#00BF62` (`brand.logo`). That green is used for the mark only, never for UI.
- Technical identifiers keep the old `workeasy360` spelling so nothing that already exists breaks: the custom-domain TXT record `_workeasy360.<domain>`, the database ownership mark, email message IDs and package names.

## Colour

Aim for roughly **70% white and neutral surfaces, 20% navy structure and 10% green accents**.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--we-primary` | `#1B3040` navy | `#27455A` | Navigation, headings, high-emphasis structure (bulk bar, hero, badges) |
| `--we-primary-hover` | `#112532` | `#315770` | Hover on navy fills |
| `--we-accent` | `#4ADE80` green | `#4ADE80` | Primary buttons, active indicators, progress, "done" ticks |
| `--we-accent-hover` | `#22C55E` | `#22C55E` | Hover on green fills |
| `--we-on-accent` | `#1B3040` | `#112532` | Text on green (7.8:1). White on green fails contrast |
| `--we-accent-soft` / `--we-accent-strong` | `#DCFCE7` / `#166534` | | Pale green background / green text |
| `--we-background` | `#F8FAFC` | `#0B1620` | Application canvas, table headers |
| `--we-surface` | `#FFFFFF` | `#112532` | Cards, top bar, inputs, menus, dialogs |
| `--we-surface-muted` | `#F1F5F9` | `#16303F` | Hover, selected rows, tags, segmented tracks |
| `--we-border` / `--we-border-strong` | `#E2E8F0` / `#CBD5E1` | `#27455A` / `#36576E` | Card and table lines / button outlines and dashed edges |
| `--we-border-input` | `#7D8BA0` | `#5A7A91` | Text field outlines: at least 3:1 against every surface they sit on (WCAG 1.4.11) |
| `--we-text-primary` | `#1B3040` | `#F1F5F9` | Headings, titles, values |
| `--we-text-body` | `#334155` | `#CBD5E1` | Body text |
| `--we-text-secondary` | `#64748B` | `#94A3B8` | Hints, labels, metadata |
| `--we-link` | `#166534` | `#4ADE80` | Text links, always underlined |
| `--we-focus` | `#1B3040` | `#4ADE80` | Focus rings. Green on navy surfaces (sidebar, bulk bar) |

**Never use brand green for small text on white** (1.9:1). For green text, use `--we-accent-strong` or `--we-success-text`. Secondary text passes AA on white and on the canvas, but not on `--we-surface-muted` (4.3:1), so don't put it there.

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

- **Sidebar** (navy, 248px): product logo and name, then the navigation in groups. The active item has a lighter fill, a green bar and a green icon. On screens narrower than 960px the sidebar becomes a drawer.
- **Top bar** (white, 56px):
  - Left: the workspace switcher (here, the store) and search. Search jumps to any module or page the role can open; press `/` or Ctrl+K to focus it.
  - Right: product actions (View store), notifications, settings, the theme toggle and the account menu.
- **Notifications** list what needs attention, using the counts the module pages already show: unpaid and unfulfilled orders, reviews to moderate, and low or out-of-stock items. Each role sees only what it can act on.

## The page contract

Every admin page has the same skeleton, built from `@workeasy/ui/react`:

1. `<Page>`: centred container, 1200px wide. A `narrow` page keeps the same left edge and caps its content at 880px.
2. `<PageHeader eyebrow title subtitle actions>`. The primary action sits at the right edge.
3. An optional `.c-toolbar` (search, filters) or `.c-tabs`.
4. Content: `<Card>`, `.c-stats` with `<StatCard>`, `.c-table-wrap` tables, `.c-form` forms.
5. Before there is data: `<EmptyState icon title actions>`.

The 14 modules are declared once, in `apps/admin/src/lib/modules.tsx`, with their label, path, group, icon, permission, summary, primary action and feature list. The sidebar, the search and each module page all read from that list, so a module's name or icon can't drift between places.

## Sidebar groups

- **Overview:** Dashboard
- **Catalog:** Products, Collections, Inventory, Media Library
- **Sales:** Orders, Offers, Reviews
- **Operations:** Shipping, Payments & Finances
- **Growth:** Analytics, Store Design, AI Studio
- **Store:** Settings (pinned to the bottom)

The sidebar shows only the modules the user's role can open. The API enforces the same permissions on every request.

## Storefronts

A shop belongs to its merchant, so it wears the merchant's brand rather than WorkEasy360's:

- Store Design sets the accent and dark colours.
- `.sf-root` (in `apps/storefront/src/app/storefront-css.ts`) maps the brand roles (`--we-accent`, `--we-primary`, `--we-link`, `--we-focus`) to those colours.
- The shop keeps its own decorative defaults (`--sf-*`).

Shops still share the neutral tokens and `c-*` primitives. Platform pages outside a shop, such as the storefront home and "not found" pages, use the WorkEasy360 look.
