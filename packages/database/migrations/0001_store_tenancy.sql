-- Store tenancy foundation (docs/02-data-model.md).
--
-- A store is the tenant: every merchant-owned row carries store_id and is
-- isolated by FORCEd row-level security. Runs as wec_owner, which owns
-- every object. Runtime roles (wec_api, wec_worker, wec_public)
-- never own tables and have no BYPASSRLS, so the policies always apply to them.
--
-- Store context is transaction-local:
--   SELECT set_config('app.store_id', '<uuid>', true);
-- Missing context yields no store rows.

GRANT USAGE ON SCHEMA app TO wec_api, wec_worker, wec_public;

-- Context accessors and shared triggers ----------------------------------------

CREATE FUNCTION app.current_store_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.store_id', true), '')::uuid $$;

CREATE FUNCTION app.current_app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION app.reject_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;

-- stores -----------------------------------------------------------------------
-- The slug is the public shop address (<storefront>/s/<slug>); it locates a
-- store and never grants access. Money is kept in minor units of `currency`.

CREATE TABLE app.stores (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  -- ISO 4217, e.g. INR, USD.
  currency       text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  -- ISO 3166-1 alpha-2 country the store sells from.
  country        text NOT NULL DEFAULT 'IN' CHECK (country ~ '^[A-Z]{2}$'),
  -- BCP 47 language the storefront falls back to.
  default_locale text NOT NULL DEFAULT 'en' CHECK (default_locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  contact_email  text CHECK (char_length(contact_email) <= 254),
  home_region    text NOT NULL DEFAULT 'default' CHECK (char_length(home_region) BETWEEN 1 AND 64),
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 65536),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON app.stores
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stores FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON app.stores
  USING (id = app.current_store_id())
  WITH CHECK (id = app.current_store_id());

-- users (global identities; issuer + subject is the identity key, not email) --

CREATE TABLE app.users (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  issuer       text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 500),
  subject      text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  display_name text CHECK (char_length(display_name) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- memberships: staff accounts of a store ---------------------------------------

CREATE TABLE app.memberships (
  store_id   uuid NOT NULL REFERENCES app.stores (id),
  user_id    uuid NOT NULL REFERENCES app.users (id),
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'fulfillment', 'analyst')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON app.memberships (user_id);

CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON app.memberships
  USING (store_id = app.current_store_id())
  WITH CHECK (store_id = app.current_store_id());

-- A signed-in user with no store selected (GET /api/v1/me) may list its own
-- memberships and the stores they belong to. Store-scoped requests stay
-- strictly limited to that store.
CREATE POLICY memberships_self_view ON app.memberships FOR SELECT
  USING (app.current_store_id() IS NULL AND user_id = app.current_app_user_id());

CREATE POLICY stores_member_view ON app.stores FOR SELECT
  USING (
    app.current_store_id() IS NULL
    AND EXISTS (
      SELECT 1 FROM app.memberships m
       WHERE m.store_id = stores.id
         AND m.user_id = app.current_app_user_id()
         AND m.status = 'active'
    )
  );

-- users row security: a user is visible to itself (app.user_id) and to stores
-- it belongs to. The memberships subquery is itself store-filtered by RLS.
-- Only the user's own context may create or change its identity row.
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_visible ON app.users FOR SELECT
  USING (
    id = app.current_app_user_id()
    OR EXISTS (SELECT 1 FROM app.memberships m WHERE m.user_id = users.id)
  );
CREATE POLICY users_insert_self ON app.users FOR INSERT
  WITH CHECK (id = app.current_app_user_id());
CREATE POLICY users_update_self ON app.users FOR UPDATE
  USING (id = app.current_app_user_id())
  WITH CHECK (id = app.current_app_user_id());

-- auth_sessions: server-managed admin sessions. Only a SHA-256 hash of the
-- cookie token is stored.

CREATE TABLE app.auth_sessions (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id    uuid NOT NULL REFERENCES app.users (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_id_idx ON app.auth_sessions (user_id);

ALTER TABLE app.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_self ON app.auth_sessions
  USING (user_id = app.current_app_user_id())
  WITH CHECK (user_id = app.current_app_user_id());

-- password_credentials: email and password accounts, alongside OIDC. A
-- password account is an ordinary user whose identity is (issuer
-- 'urn:workeasy:password', subject = the normalized email); only a scrypt
-- hash of the password is kept.

CREATE TABLE app.password_credentials (
  user_id       uuid PRIMARY KEY REFERENCES app.users (id),
  email         text NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 20 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER password_credentials_set_updated_at BEFORE UPDATE ON app.password_credentials
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.password_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY credentials_self ON app.password_credentials
  USING (user_id = app.current_app_user_id())
  WITH CHECK (user_id = app.current_app_user_id());

-- Lookups before any context exists. These SECURITY DEFINER functions run as
-- the owner role; the owner-only read policies below let them see the rows
-- they need, and each returns only the minimum. Runtime roles still cannot
-- read these tables directly without a context.

CREATE POLICY identity_lookup ON app.users FOR SELECT TO wec_owner USING (true);
CREATE POLICY session_lookup ON app.auth_sessions FOR SELECT TO wec_owner USING (true);
CREATE POLICY credentials_lookup ON app.password_credentials FOR SELECT TO wec_owner USING (true);

CREATE FUNCTION app.find_user_id_by_identity(p_issuer text, p_subject text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT id FROM app.users WHERE issuer = p_issuer AND subject = p_subject $$;

CREATE FUNCTION app.resolve_session(p_token_hash bytea)
  RETURNS TABLE (session_id uuid, user_id uuid, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.id, s.user_id, s.expires_at
      FROM app.auth_sessions s
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
  $$;

CREATE FUNCTION app.find_password_credential(p_email text)
  RETURNS TABLE (user_id uuid, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT c.user_id, c.password_hash FROM app.password_credentials c WHERE c.email = p_email $$;

REVOKE ALL ON FUNCTION app.find_user_id_by_identity(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.find_password_credential(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_user_id_by_identity(text, text), app.resolve_session(bytea),
  app.find_password_credential(text) TO wec_api;

-- Privileges -------------------------------------------------------------------
-- No DELETE: memberships are revoked by status; stores are suspended, never
-- dropped by the runtime roles.

GRANT SELECT, INSERT, UPDATE ON app.stores, app.users, app.memberships, app.auth_sessions, app.password_credentials TO wec_api;
GRANT SELECT ON app.stores, app.users, app.memberships TO wec_worker;
