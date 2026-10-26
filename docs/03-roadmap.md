# 03 · Roadmap

Each phase ends runnable and tested.

| Phase | Scope | Status |
|---|---|---|
| 1 · Foundation | Monorepo, brand tokens and page system, logo, auth (password + OIDC), store creation, store shell with all 14 modules, Dashboard, Settings (general, staff, audit log), storefront store page | **Done** |
| 2 · Catalog | Products (physical / digital / service, options and variants), CSV import (with preview) and export, bulk actions, Media Library (direct uploads, malware scan, private files), Collections (hand-picked and rule-based), Inventory ledger with adjustments and history | **Done** |
| 3 · Storefront & checkout | Storefront home (default sections), search, collection and product pages, cart, checkout (delivery or pickup; COD, bank, UPI, WhatsApp and Telegram ordering), shopper order page, order and new-order emails, Checkout settings, Orders list and detail (mark paid / fulfilled, cancel with restock, notes), real dashboard sales | **Done** |
| 4 · Orders & money | Razorpay and Stripe with the merchant's own keys (connect with key check, encrypted at rest; pay; signed webhooks; refunds), 30-minute hold on unpaid card orders, Payments & Finances (takings and ledger), refunds (to the card or recorded by hand, with restock), partial fulfilment with tracking and shipping email, PDF invoices, customers, abandoned checkouts | **Done** |
| 5 · Commerce rules | Offers (codes and automatic: percentage, amount, free shipping; minimum spend, product/collection scope, schedule, usage limits, once per customer), shipping zones by country/state/PIN prefix with flat, weight and value rates and per-zone cash on delivery, GST/VAT (inclusive or added, per-product rates, GSTIN on invoices), bookings (weekly hours, slots, capacity, bookings calendar), digital downloads (granted on payment, limits and expiry, revoked on cancel or full refund) | **Done** |
| 6 · Engagement | Reviews from verified buyers (order page and emailed review link, moderation with publish/hide/reply, optional auto-publish of 4–5★, ratings on product pages and in search results data), anonymous storefront analytics (no IP or personal data; Do Not Track respected; 90-day raw retention) with daily rollups in the store's time zone, Analytics page (revenue, visitors, conversion, funnel, sources, top products, repeat buyers, CSV), dashboard KPIs with period comparison | **Done** |
| 7 · Design & AI | Store Design (section-based home page: hero, product grid, collections, banner, testimonials, FAQ, text; colours with contrast checks, fonts, buttons, logo, announcement bar, header/footer menus; autosaved draft, signed preview links, live preview, publish/discard), storefront in English, Hindi and Arabic (right to left) with browser-language detection and a switcher, AI Studio (product and collection copy, review summaries, sales insights in 13 languages; OpenAI, Gemini or a local stub; queued on the worker, daily allowance, proposals applied field by field) | **Done** |
| 8 · Hardening | Staff invitations (link or email, role limits, last-owner protection, role changes and removal), custom shop domains (DNS TXT verification, automatic certificates via Caddy on-demand TLS), accessibility audit with axe on every admin module and storefront page (desktop, phone, dark mode, keyboard add-to-cart), performance budgets for page JavaScript, bundle secret checks, Docker image, CI and SSH deploy with automatic rollback, backups | **Done** |
| 9 · Offers & content | Buy X get Y offers (same or different products, free or a percentage off, cheapest items discounted, optional per-order limit; as codes or automatic), content pages (About, shipping, returns, privacy, terms and contact templates filled with the store's details; light Markdown with live preview; drafts and publishing; search listing; linkable from header and footer menus) | **Done** |

The roles are **owner, admin, staff, fulfillment and analyst**. `packages/auth/src/permissions.ts` defines what each role can do.

Sailo (sailo.store) is the reference for:

- chat checkout
- payments with seller-written instructions
- digital downloads and bookings
- language auto-detection
- analytics retention by plan
