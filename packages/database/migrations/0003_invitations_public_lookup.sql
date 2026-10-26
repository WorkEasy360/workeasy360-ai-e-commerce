-- Staff invitations and the storefront's public store lookup.
--
-- Owners and admins create a single-use link for a role; only a SHA-256 hash
-- of its token is stored. Links expire and can be revoked. The email address
-- is a label for the inviter only.

CREATE TABLE app.invitations (
  id          uuid NOT NULL DEFAULT uuidv7(),
  store_id    uuid NOT NULL REFERENCES app.stores (id),
  email       text CHECK (char_length(email) <= 254),
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'fulfillment', 'analyst')),
  token_hash  bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by  uuid NOT NULL REFERENCES app.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_by uuid REFERENCES app.users (id),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT invitations_outcome CHECK ((accepted_at IS NULL) = (accepted_by IS NULL) AND NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE INDEX invitations_store_idx ON app.invitations (store_id, created_at DESC);

ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON app.invitations
  USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id());

-- Before joining, the invitee has no store context. This read-only lookup
-- only says which store an open link belongs to; accepting then happens in
-- that store's context.
CREATE POLICY invitation_lookup ON app.invitations FOR SELECT TO wec_owner USING (true);

CREATE FUNCTION app.resolve_invitation(p_token_hash bytea)
  RETURNS TABLE (store_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT i.store_id FROM app.invitations i
     WHERE i.token_hash = p_token_hash
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION app.resolve_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_invitation(bytea) TO wec_api;

GRANT SELECT, INSERT ON app.invitations TO wec_api;
GRANT UPDATE (accepted_by, accepted_at, revoked_at) ON app.invitations TO wec_api;

-- Public store lookup ------------------------------------------------------------
-- The storefront finds a shop by its slug before any store context exists.
-- Only active stores resolve, and only the fields a shopper may see.

CREATE POLICY store_lookup ON app.stores FOR SELECT TO wec_owner USING (true);

CREATE FUNCTION app.resolve_public_store(p_slug text)
  RETURNS TABLE (id uuid, slug text, name text, currency text, country text, default_locale text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.id, s.slug, s.name, s.currency, s.country, s.default_locale
      FROM app.stores s
     WHERE s.slug = p_slug AND s.status = 'active'
  $$;

-- Whether a slug is in use by any store, for the admin's availability check
-- while creating or renaming a store. Says nothing else about the store.
CREATE FUNCTION app.store_slug_taken(p_slug text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM app.stores WHERE slug = p_slug) $$;

REVOKE ALL ON FUNCTION app.resolve_public_store(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.store_slug_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_public_store(text) TO wec_public, wec_api;
GRANT EXECUTE ON FUNCTION app.store_slug_taken(text) TO wec_api;
