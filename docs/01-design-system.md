# 01 · Design system

All colours come from the Workeasy360 logo (`packages/ui/assets/logo.jpg`). Tokens are defined once, in `packages/ui/src/tokens.ts`, and published as CSS variables:

- colours: `--we-color-*`
- gradients: `--we-gradient-brand`, `--we-gradient-soft`
- chart series: `--we-chart-1…5`
- spacing and radii: `--we-space-*`, `--we-radius-*`

## Palette

| Token | Light | Dark | Use |
|---|---|---|---|
| navy | `#071C45` | `#122A5E` | Sidebar, hero panels, the "W" |
| accent (blue) | `#1257C6` | `#6B98F0` | Primary buttons, links, focus |
| teal | `#08A8B8` | `#2CC9D6` | Secondary accents, chart series 2 |
| mint | `#05E3A0` | `#34EBB4` | Highlights, active nav icon, "done" ticks. Never body text on white |
| brand gradient | blue → teal → mint, 135° | same | Logo ring, brand buttons, progress, active-nav bar, AI tag |

Surfaces are white and `#F5F8FC` in light mode, `#0B1430` and `#0F1A36` in dark mode. Dark mode follows the operating system until someone chooses with the theme toggle. The choice is saved per browser and applied before first paint, so the page doesn't flash the wrong theme.

## The page contract

Every admin page has the same skeleton, built from `@workeasy/ui/react`:

1. `<Page>`: centred container, 1200px wide. A `narrow` page keeps the same left edge and caps its content at 880px.
2. `<PageHeader eyebrow title subtitle actions>`. The primary action sits at the right edge.
3. An optional `.c-toolbar` (search, filters) or `.c-tabs`.
4. Content: `<Card>`, `.c-stats` with `<StatCard>`, `.c-table-wrap` tables, `.c-form` forms.
5. Before there is data: `<EmptyState icon title actions>`.

The 14 modules are declared once, in `apps/admin/src/lib/modules.tsx`, with their label, path, group, icon, permission, summary, primary action and feature list. The sidebar and each module page read from that list, so a module's name or icon can't drift between places.

## Sidebar groups

- **Overview:** Dashboard
- **Catalog:** Products, Collections, Inventory, Media Library
- **Sales:** Orders, Offers, Reviews
- **Operations:** Shipping, Payments & Finances
- **Growth:** Analytics, Store Design, AI Studio
- **Store:** Settings (pinned to the bottom)

The sidebar shows only the modules the user's role can open. The API enforces the same permissions on every request.
