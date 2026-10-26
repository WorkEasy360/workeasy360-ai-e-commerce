# 02 · Architecture and data model

## Tenancy

A **store** is the tenant. All merchant-owned tables carry `store_id`, and each table has a FORCEd row-level-security policy:

```sql
USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())
```

`withContext(db, { storeId, userId }, fn)` (`packages/database/src/context.ts`) sets `app.store_id` and `app.user_id` with transaction-local `set_config`. A pooled connection therefore never carries one request's context into the next.

## Database roles

| Role | Used by | Can |
|---|---|---|
| `wec_owner` | migrations | owns every object |
| `wec_api` | `/api/v1`, `/auth` | read and write store rows within a store context |
| `wec_worker` | worker | run outbox and job functions, read within a store context |
| `wec_public` | `/public/v1` | call lookup functions only (`app.resolve_public_store`) |

Lookups that run before any context exists are `SECURITY DEFINER` functions. Each one returns only the minimum it needs to:

- sessions
- password credentials
- invitations
- slug availability
- the public store lookup

## Tables

| Migration | Tables |
|---|---|
| `0001_store_tenancy` | `stores`, `users`, `memberships`, `auth_sessions`, `password_credentials` |
| `0002_audit_outbox_jobs` | `audit_events` (append-only), `outbox_events`, `jobs` (+ `dispatch_outbox`, `claim_jobs`, `complete_job`) |
| `0003_invitations_public_lookup` | `invitations`; `resolve_public_store`, `store_slug_taken` |
| `0004_catalog` | `media_assets`, `products`, `product_options`, `variants`, `product_media`, `product_files`, `collections`, `collection_products`, `inventory_levels`, `inventory_movements`; `resolve_public_media` |
| `0005_storefront_checkout_orders` | Restrictive storefront read policies for the public role; `checkout_settings`, `customers`, `order_counters`, `orders`, `order_items`, `order_events` |
| `0006_fix_upi_id_check` | Corrects the UPI ID check from 0005 |
| `0007_payments_fulfilment` | `payment_accounts` (gateway keys encrypted with `SECRETS_ENCRYPTION_KEY`), `payments`, `refunds`, `fulfillments`, `fulfillment_items`, `webhook_events` (de-duplication), `checkouts`; card payment and refund statuses on `orders` |
| `0008_expire_card_orders` | `overdue_card_orders` for the worker, which cancels unpaid card orders after their payment window |
| `0009_commerce_rules` | `discounts`, `discount_redemptions`, `shipping_zones`, `shipping_rates`, `tax_settings`, `download_grants`; product `tax_rate_bps` and `booking_hours`; discount, tax and shipping-rate columns on `orders` and `order_items` (the total check now subtracts discounts and adds tax only when prices exclude it) |
| `0010_reviews_analytics` | `reviews`, `review_settings`, `review_requests`, `analytics_events` (anonymous, 90-day retention), `analytics_daily`, `analytics_sources_daily`, `analytics_products_daily`; `analytics_active_stores` and `purge_analytics_events` for the worker |
| `0011_review_request_upsert` | Lets the worker replace an order's review link |
| `0012_ai_studio_design` | `ai_generations` (requests, proposals, apply/discard), `ai_usage_days` (daily allowance), `store_themes` (draft and published theme; shoppers' role reads only the published one) |
| `0013_custom_domains` | `stores.custom_domain`, `domain_token`, `domain_verified_at`, `domain_checked_at` (one domain per store, unique across stores); `app.resolve_store_domain` lets the storefront map a verified host to its shop |
| `0014_buy_x_get_y` | `discounts.type` gains `buy_x_get_y`, with `buy_quantity`, `get_quantity`, `get_applies_to` / `get_target_ids` (what's got: the same products, collections or products) and `max_applications` |
| `0015_store_pages` | `store_pages` (content pages: handle, title, light-Markdown body, search listing, published); a restrictive policy lets shoppers' role read published pages only |

Later phases may add translations of merchant content.

Money is stored as integer minor units, together with the store's ISO 4217 currency.

## Events and jobs

API changes write their `outbox_events` row in the same transaction as the change. The worker turns committed events into jobs, one per subscribed job type, and runs each job under a lease. Failed jobs are retried with backoff, then dead-lettered.

Each job's dedupe key is stable across retries, so destinations can recognise a repeat. Job types are registered in `apps/worker/src/jobs.ts` as each module arrives.
