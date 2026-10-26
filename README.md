# Workeasy360 AI Commerce

Workeasy360 AI Commerce is a multi-store e-commerce builder: storefront, checkout and order management. Each merchant runs one or more stores from an admin with fourteen modules. Their shoppers buy at `<storefront>/s/<store-address>`.

It shares its stack and conventions with the Workeasy360 AI Form Builder:

- pnpm monorepo, Node 24, TypeScript
- Next.js 16 for the admin and storefront
- Express 5 API
- PostgreSQL 18 with forced row-level security per store
- a durable job worker

## Layout

| Path | What |
|---|---|
| `apps/admin` | Merchant admin (port 3000): sign-in, store onboarding, the store shell and all 14 modules |
| `apps/storefront` | Public shops (port 3001) at `/s/<slug>` |
| `apps/api` | Express API: `/auth` (sign-in), `/api/v1` (admin, cookie session), `/public/v1` (storefront, public DB role) |
| `apps/worker` | Outbox dispatch and durable jobs |
| `packages/ui` | Brand tokens from the logo, the shared admin page system (`c-*` classes), logo mark, icons, theme toggle |
| `packages/database` | SQL migrations, Kysely repositories, `withContext` / `withStore` row-security transactions |
| `packages/auth` | Store roles and permissions; OIDC interfaces |
| `packages/commerce` | Pure, browser-safe commerce logic: money in minor units, handles, variants, collection rules, product CSV |
| `packages/files` | Media storage (presigned uploads, signed views and downloads), type detection and the `media.scan` job |
| `packages/jobs`, `packages/observability`, `packages/test-fixtures` | Shared infrastructure |
| `docs/` | Design system, architecture and roadmap |

## Run it locally

You need Node 24, pnpm 12 and Docker Desktop. Without a global pnpm, run `corepack enable` once (the root scripts call `pnpm`).

```sh
cp .env.example .env
pnpm install
pnpm infra:up        # Postgres, Redis, object storage, Mailpit, Dex, ClamAV (allow ~2 min the first time)
pnpm db:setup        # roles, database, migrations
pnpm db:seed         # demo stores: /s/demo and /s/globex-studio
pnpm dev             # admin :3000, storefront :3001, API :4000, worker
```

How to sign in:

- **Create an account:** at http://localhost:3000 you can create an account with an email and password.
- **Seeded owner:** you can sign in with SSO as `asha@acme.test` / `local-dev-password`. Asha owns the seeded demo store.

The demo shop is at http://localhost:3001/s/demo.

The infra uses the same host ports as the form builder. Run one project's infra at a time, or change the `*_PORT` values in `.env`.

### Online payments (Razorpay, Stripe)

Each merchant connects their own gateway account in **Payments & Finances** by pasting their API keys and webhook signing secret. The API checks the keys with the gateway before saving them, encrypted with `SECRETS_ENCRYPTION_KEY` (keep that key secret, and the same for the API and worker; changing it means merchants must re-enter their keys).

- Use test-mode keys (`rzp_test_…`, `sk_test_…`) to try a payment end to end. Test payments are listed but not counted in takings.
- Gateways must reach the webhook URL shown in the connect dialog. Set `API_PUBLIC_URL` to the API's public address; locally, use a tunnel.
- Unpaid card orders hold their stock for 30 minutes, then the worker cancels them.
- The integration tests run the full flow (connect, pay, webhooks, refunds) against a fake gateway with real signatures, so no keys are needed for `pnpm test:integration`.

## Checks

```sh
pnpm typecheck && pnpm lint && pnpm test   # unit tests
pnpm test:integration                      # needs `pnpm infra:up`; recreates <db>_test
pnpm build
pnpm check:bundles && pnpm check:servers   # no secrets in browser bundles; built servers start
pnpm check:a11y                            # axe audit; needs the stack running (`pnpm dev`)
pnpm check:budgets --store <slug>          # page JavaScript budgets; needs production servers
```

Deployment to AWS (EC2, the shared Aurora cluster, S3, SES, GitHub Actions) is described in [docs/deployment.md](docs/deployment.md).

## Security model (inherited from the form builder)

- **Store isolation:** every merchant row carries `store_id` and is protected by forced RLS. The API sets the store only after it confirms the user has an active membership. A store the user can't access returns 404.
- **Database roles:**
  - Runtime roles (`wec_api`, `wec_worker`, `wec_public`) own no tables and cannot bypass RLS.
  - The storefront reaches data only through narrow `SECURITY DEFINER` lookups, such as `app.resolve_public_store`.
- **Sessions and CSRF:**
  - Sessions are server-side, and only the token hash is stored.
  - The cookie is `wec_session` (`__Host-` over HTTPS).
  - Mutations must come from the admin origin.
- **Audit trail and outbox:** `audit_events` is append-only. Outbox events are written in the same transaction as the change they record.
