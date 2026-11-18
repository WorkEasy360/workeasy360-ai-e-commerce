# Sign-in with WorkEasy360 Accounts

The merchant admin of Workeasy AI Commerce can sign people in with **WorkEasy360 Accounts**, the identity provider of the WorkEasy360 product family. The admin never sees a WorkEasy360 password. It receives an ID token that names:

- the person (`sub`);
- the WorkEasy360 organization they chose (`organization_id`);
- this product (`product_code`).

It then keeps its own session, authorizes on organization and store role, asks WorkEasy360 whether the organization is still entitled, and ends the session when WorkEasy360 says so (back-channel logout).

It is **off** until `WORKEASY360_ISSUER` is set. Email and password sign-in keeps working unless `WORKEASY360_SSO_ONLY=true` ([Migration](#migration-safety)).

**Shoppers are not affected.** The storefront and its customers never use WorkEasy360; only the merchant admin does.

## Organizations own stores

In WorkEasy360 a person works in an **organization**. Here an organization **owns stores** (`stores.workeasy360_organization_id`), one or several, and a WorkEasy360 session is bound to the one organization its ID token named:

- **It reaches only that organization's stores.** Any other store answers 404, as for a non-member, even when the person also belongs to stores elsewhere. `GET /api/v1/me` lists only that organization's stores.
- **The organization's first store** is created by its first person, in the admin's existing "Create your store" step, because a store needs a public address, a currency and a country the merchant chooses. That person becomes its owner.
- **More stores:** an owner of one of the organization's stores can add another. Another member gets 403 `WORKEASY360_STORES`. With `WORKEASY360_PROVISION_STORES=false`, nobody creates stores through WorkEasy360; only stores the operator links can be signed in to, and an organization without one is refused (`no_store`).
- **Existing stores** are linked to an organization by the operator: `link-workeasy360-organization <store> <organization>`.
- **People:** the person is linked on **(issuer, sub)**, never on email. In each store of the organization:
  - an active membership keeps its role;
  - a revoked one stays revoked, because a store administrator removed the person;
  - with none yet, one is created with `WORKEASY360_DEFAULT_ROLE` (`staff`).

  Someone revoked from every store of the organization is refused (`membership_revoked`).
- **Roles:** inside a store, the role decides, as before. Authorization is organization plus role, never `sub` alone. An invitation to a store of another organization is refused for a WorkEasy360 session (403 `WORKEASY360_OTHER_ORGANIZATION`).

## What happens, step by step

| Step | What the admin does | Where |
|---|---|---|
| Start | `GET /auth/workeasy360/start[?organization=<uuid>]`. Generates state, nonce and a PKCE S256 verifier and stores them **in PostgreSQL** (`app.workeasy360_login_flows`, 10 minutes). The browser holds only a random flow id in an httpOnly cookie (`__Host-wec_w360_flow` over https). The launcher's organization is forwarded as the `organization` hint. | `apps/api/src/workeasy360/routes.ts`, `client.ts` |
| Callback | `GET /auth/workeasy360/callback`. **Takes** (deletes) the flow before anything else, so it is used once. Compares the state in constant time. | `routes.ts` |
| Code exchange | openid-client 6 `authorizationCodeGrant` with the PKCE verifier. Client authentication is **`private_key_jwt`**: the assertion has `iss = sub = client id`, `aud` = the token endpoint, a 60 s lifetime and a fresh `jti`, signed with `WORKEASY360_PRIVATE_KEY_FILE` (kid `WORKEASY360_KEY_ID`). | `client.ts` |
| ID token | Verified **again, with jose, against the provider's key set**: key by `kid`, algorithm from an allow-list (RS256, ES256), `iss` exactly `WORKEASY360_ISSUER`, `aud` exactly the client id, `exp`/`iat` with 30 s skew, `typ` = `id_token`, `nonce`, `product_code` = `WORKEASY360_PRODUCT_CODE` (`ai_commerce`), `organization_id` present, `email_verified` = true. | `client.ts` `verifyIdToken` |
| Launcher check | If the sign-in started with `?organization=`, the token must name that organization. | `routes.ts` |
| Entitlement | Asks the entitlement endpoint from discovery (`workeasy360_entitlement_endpoint`) for the organization and the person, with a `private_key_jwt` client assertion. A denial ends the sign-in on a "no access" page with a purchase path. | `entitlements.ts` |
| Stores | Places the person in the organization's stores (see above). | `packages/database/src/repositories/workeasy360.ts` |
| Session | Any session the browser already held ends. A new server-side session is bound to the organization, with the provider's `sid`. The cookie is httpOnly, `__Host-wec_session` over https: Secure, host-only, never a `.workeasy360.com` cookie. The browser lands on the store (one), the store chooser (several), or "Create your store" (none). | `identity.ts` `createSession` |

Every failure lands on `/?sso_error=<code>` (a fixed vocabulary; see `SsoErrorCode` in `routes.ts`). Codes, tokens, state and nonce are never logged.

## Entitlement, on WorkEasy360's schedule

Every `/api/v1/stores/:storeId/...` request to a store owned by an organization goes through `storeGate` (`apps/api/src/workeasy360/access.ts`). This includes password sessions of its members, which are asked about per organization.

- **Cache:** the answer is kept for `min(revalidate_after, 900)` seconds (at least 30), in PostgreSQL (`app.workeasy360_entitlements`), shared by every API instance, plus each process's own copy. WorkEasy360 is never asked per request.
- **Denial:** re-asked after 60 s. Until then, and through any outage, it stands. A known denial is kept without expiry. The answer is 403 `WORKEASY360_ACCESS_ENDED` with `reason`. The session stays valid, so the admin shows "access has ended" with a purchase link and sign-out.
- **Read-only:** while `write_allowed` is false, writes answer 403 `WORKEASY360_READ_ONLY`. Reads, including the CSV exports, still work.
- **Outage:** a 5xx, a 429, a timeout or a network error is never a denial. The last answer stands; with none yet, access continues. WorkEasy360 is asked again after 60 s.
- **Refusal of the client:** a 400, 401 or 403 from the entitlement endpoint fails **closed** for the whole client. For 60 s every question answers 403 `WORKEASY360_ACCESS_UNVERIFIED`, and a 429 within five minutes of the refusal counts as one. Then one question is asked again.
- **Storefront:** shoppers' checkout and order traffic is not gated. The entitlement governs the merchant admin. Whether a lapsed organization's shops should close is a product decision not taken here.

## Back-channel logout, and the session check on every request

`POST /auth/workeasy360/backchannel-logout` with the form field `logout_token`. The call is server to server; the provider's signature is the authentication.

The logout token is verified with jose against the provider's key set:

- JOSE `typ` is `logout+jwt`, and a `typ` claim, if present, is `logout_token`;
- the signature is by `kid` (RS256 or ES256);
- `iss` is exactly ours and `aud` is our client id;
- `iat` is at most 10 minutes old and not in the future, and `exp` has not passed;
- the back-channel-logout event is present, and there is **no `nonce`**;
- `sub` and/or `sid` are present, and so is a `jti`.

Then, in **one PostgreSQL transaction** (`app.workeasy360_end_sessions`):

1. The `jti` is recorded once per issuer.
2. With `sid`, that WorkEasy360 sign-in's sessions end (narrowed to `sub` when both are present). With `sub` alone, every session of that person ends.

The receiver answers:

- **200** when the token is verified. A **duplicate** delivery also gets 200.
- **400** `invalid_request` when the token is invalid.
- **503** when the key set or the database is unreachable, so WorkEasy360 delivers again.

**The per-request check:** every authenticated request resolves its cookie through `app.resolve_session` in PostgreSQL, and nothing is cached in a process. A session ended through *any* instance is refused (401) by *every* instance on its next request.

## Signing out

- **Sign out** (`POST /auth/logout`) ends the admin session only.
- **Sign out of WorkEasy360 too** (`POST /auth/logout?workeasy360=1`, shown for a WorkEasy360 session) first ends the admin session. It then sends the browser to WorkEasy360's `end_session_endpoint` with `id_token_hint`, `client_id` and the registered `WORKEASY360_POST_LOGOUT_REDIRECT_URI`. WorkEasy360 asks the person to confirm.

## Register in Super Admin

The platform catalog has **no `ai_commerce` product yet**: create it first, or set `WORKEASY360_PRODUCT_CODE` to whatever code it gets. Then, under Product → Integration:

| Field | Value |
|---|---|
| Launch URL | `https://<admin host>/auth/workeasy360/start` (the launcher appends `?organization=<uuid>`) |
| Redirect URI | `https://<admin host>/auth/workeasy360/callback`, exactly |
| Back-channel logout URI | `https://<admin host>/auth/workeasy360/backchannel-logout` (same origin as the redirect URI) |
| Post-logout redirect URI | `https://<admin host>/`, exactly what `WORKEASY360_POST_LOGOUT_REDIRECT_URI` says |
| Scopes | `openid email profile organization`. `email` is required: `email_verified` comes with it. |
| Token endpoint auth method | `private_key_jwt` |
| Sign-in mode | `sso_optional` with login URL `https://<admin host>/` while password sign-in is on. `sso_only` once `WORKEASY360_SSO_ONLY=true`. |
| Credential | The **public** key below. Its credential id is `WORKEASY360_KEY_ID`. |

Generate the key pair on the product's machine. The private key goes only into the secret manager, mounted into the api container as a file:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out workeasy360-commerce.pem   # private: never commit
openssl pkey -in workeasy360-commerce.pem -pubout -out workeasy360-commerce.pub.pem           # public: paste into Super Admin
```

### Hostnames: a prerequisite to go live

WorkEasy360 activates an integration only once **every hostname in it is proven by a DNS TXT record** (`_w360-product-verify.<host>`, ADR-070).

- The deployed admin runs on `admin.52-74-204-245.sslip.io`. Nobody here controls the `sslip.io` zone, so it **cannot be proven**. A real hostname on `workeasy360.com` (or another owned domain) for the admin is a prerequisite for going live.
- **Conflict to resolve:** `docs/deployment.md` and `infra/aws/env.example` planned `admin.workeasy360.com` for this admin. **That hostname is already WorkEasy360's Super Admin portal.** Choose another one, for example `commerce-admin.workeasy360.com`, with the platform team. No DNS has been changed.

## Environment

All names are those of the WorkEasy360 integration kit's `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `WORKEASY360_ISSUER` | (empty: off) | Exactly the issuer WorkEasy360's discovery document names, **no trailing slash**. https; plain http only for a loopback issuer outside production. |
| `WORKEASY360_CLIENT_ID` | | The client id from the registration. |
| `WORKEASY360_PRODUCT_CODE` | `ai_commerce` | Must equal the ID token's `product_code`. |
| `WORKEASY360_REDIRECT_URI` | `<ADMIN_PUBLIC_URL>/auth/workeasy360/callback` | Must be exactly that address. |
| `WORKEASY360_POST_LOGOUT_REDIRECT_URI` | `<ADMIN_PUBLIC_URL>/` | On the admin origin; registered exactly. |
| `WORKEASY360_KEY_ID` | | The credential id (`kid` of the client assertion). |
| `WORKEASY360_PRIVATE_KEY_FILE` | | PEM file, RSA or EC P-256. Never in the repository or an image. |
| `WORKEASY360_SCOPES` | `openid email profile organization` | Must include `openid` and `email`. |
| `WORKEASY360_SSO_ONLY` | `false` | `true`: WorkEasy360 is the only way into the admin. |
| `WORKEASY360_DEFAULT_ROLE` | `staff` | Role in an organization's store for someone who is not a member yet. |
| `WORKEASY360_PROVISION_STORES` | `true` | `false`: only stores linked by the operator can be signed in to. |
| `WORKEASY360_PURCHASE_URL` | the issuer | The "Get Workeasy AI Commerce" link on the no-access page. |

`ISSUER`, `CLIENT_ID`, `KEY_ID` and `PRIVATE_KEY_FILE` must all be set, or none. The API refuses to start otherwise, or with a trailing slash, a non-https issuer in production, a redirect URI elsewhere, or `OIDC_ISSUER_URL` equal to the WorkEasy360 issuer.

## Migration safety

**Password sign-in keeps working** while `WORKEASY360_SSO_ONLY` is false, which is the default. Existing merchants are not locked out. Their password sessions in a store an operator links to an organization are then subject to that organization's entitlement.

**With `WORKEASY360_SSO_ONLY=true`:**

- `/auth/password/*` answers 403 `PASSWORD_SIGN_IN_DISABLED`;
- the generic single sign-on redirects to WorkEasy360;
- every session opened another way is refused at once (401 `WORKEASY360_SIGN_IN_REQUIRED`).

**What happens to existing accounts.** People are keyed on `(issuer, subject)`. Nothing is merged by email.

| Existing account | On the person's first WorkEasy360 sign-in |
|---|---|
| Password account | Untouched. The WorkEasy360 person is a **separate** user: in a linked store they join with the default role. To keep the password account's roles instead, run `link-workeasy360-user` **before** their first WorkEasy360 sign-in. Otherwise an owner changes the new member's role on the Team page. |
| Generic OIDC account (`OIDC_ISSUER_URL`) | Untouched and never matched. Use `link-workeasy360-user` per person to carry it over. |
| WorkEasy360 account under a **previous issuer name** (an issuer move, ADR-067) | **Refused** with `sso_error=identity_conflict` instead of silently becoming a second account. Run `move-identity-issuer` in the same release that changes `WORKEASY360_ISSUER`. |

## Operator commands

They run as the owner role (`DATABASE_MIGRATION_URL`): `pnpm --filter @workeasy/database db <command>`.

| Command | What it does |
|---|---|
| `link-workeasy360-organization <store-id> <workeasy360-organization-id>` | The store now belongs to that organization. Run it once per store. A store that belongs to another organization is never re-pointed. Audited (`store.linked_to_workeasy`). |
| `link-workeasy360-user <user-id> <workeasy360-sub> [--issuer <issuer>]` | You vouch that an existing account is this WorkEasy360 person. It is re-keyed to `(issuer, sub)` and keeps its memberships. Refused when that identity already has its own user. |
| `move-identity-issuer --from <old> --to <new> [--apply]` | The identity move of an issuer change. Without `--apply` it only reports. It refuses, listing the pairs, when a subject already has a user under the new issuer. |
| `workeasy360-identities` | Users and live sessions per issuer. |

## Run it locally against a WorkEasy360 provider on `http://127.0.0.1:8031`

1. Run a WorkEasy360 platform locally with issuer `http://127.0.0.1:8031`.
2. Create the catalog product `ai_commerce`.
3. Register the integration with these addresses:
   - redirect URI `http://localhost:3000/auth/workeasy360/callback`;
   - back-channel logout URI `http://localhost:3000/auth/workeasy360/backchannel-logout`;
   - post-logout URI `http://localhost:3000/`;
   - scopes `openid email profile organization`.
4. Add the public key, activate, and grant the product to a test organization. Loopback hosts need no DNS proof.
5. Fill in `.env`:

   ```dotenv
   WORKEASY360_ISSUER=http://127.0.0.1:8031
   WORKEASY360_CLIENT_ID=<client id>
   WORKEASY360_KEY_ID=<credential id>
   WORKEASY360_PRIVATE_KEY_FILE=../secrets/workeasy360-commerce.pem
   WORKEASY360_REDIRECT_URI=http://localhost:3000/auth/workeasy360/callback
   WORKEASY360_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/
   ```

6. Start the stack: `pnpm infra:up && pnpm db:setup && pnpm dev`.
7. Open `http://localhost:3000/` and choose **Continue with WorkEasy360**, or open `http://localhost:3000/auth/workeasy360/start?organization=<uuid>` as the launcher would.

The platform must reach `http://localhost:3000/auth/workeasy360/backchannel-logout`. The admin proxies `/auth/*` to the API.

### Proving 200 vs 401 from a script

The protected endpoint is **`GET /api/v1/me`** on the admin origin. The credential is the **session cookie** set by the callback: `wec_session` over http, `__Host-wec_session` over https.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: wec_session=<value>' http://localhost:3000/api/v1/me   # 200
# sign out everywhere in WorkEasy360 (it delivers a logout token), then the same call:
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: wec_session=<value>' http://localhost:3000/api/v1/me   # 401
```

`GET /api/v1/stores/<store id>` answers 200 while the organization is entitled, and 403 `WORKEASY360_ACCESS_ENDED` once it is not.

## Tests

`apps/api/src/workeasy360.int.test.ts` runs against a fake WorkEasy360 provider built in the test suite (`apps/api/src/workeasy360/fake-provider.ts`). Its keys are generated when it starts. The tests cover:

- the happy path, including the organization's first store;
- a wrong issuer, audience, signature, nonce or `typ`, and `alg: none`;
- a missing or used flow, and a wrong state;
- a wrong product code;
- a missing organization;
- an unverified email;
- the wrong organization;
- not entitled;
- cross-organization access refused;
- operator link, a removed member, provisioning off, an invitation from another organization;
- entitlement re-checks: read-only, denial, outage, refusal of the client;
- logout tokens: valid (sid and sub), forged (bad signature, other issuer, other audience, wrong `typ`, missing event, with nonce, too old, neither sub nor sid), duplicate, and a replayed `jti`;
- sessions refused at once on **two app instances** sharing the database;
- both sign-outs;
- SSO-only;
- the identity moves.

`apps/api/src/workeasy360/config.test.ts` covers the configuration rules.

## Not covered yet

- **Automatic start** for SSO-only products (integration guide §6b): when someone opens the admin with no session, it shows its sign-in page with "Continue with WorkEasy360" rather than starting the sign-in by itself.
- A store is linked to one organization at a time. Moving a store between organizations is a deliberate database change.
- `prompt=login` ("confirm it's you") for sensitive actions is not used.
