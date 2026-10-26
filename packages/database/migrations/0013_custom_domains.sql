-- Custom domains.
--
-- A store can serve its shop on its own domain (shop.example.com). The
-- merchant proves they control it with a DNS TXT record holding a random
-- token; until then the domain does nothing. Only verified domains resolve
-- to a store, and only through resolve_store_domain, which the storefront
-- and the TLS certificate check call before any store context exists.

ALTER TABLE app.stores
  ADD COLUMN custom_domain      text CHECK (custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' AND char_length(custom_domain) <= 253),
  ADD COLUMN domain_token       text CHECK (domain_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  ADD COLUMN domain_verified_at timestamptz,
  ADD COLUMN domain_checked_at  timestamptz,
  ADD CONSTRAINT stores_domain_pair_check CHECK ((custom_domain IS NULL) = (domain_token IS NULL)),
  ADD CONSTRAINT stores_domain_verified_check CHECK (domain_verified_at IS NULL OR custom_domain IS NOT NULL);

CREATE UNIQUE INDEX stores_custom_domain_idx ON app.stores (custom_domain) WHERE custom_domain IS NOT NULL;

CREATE FUNCTION app.resolve_store_domain(p_host text)
  RETURNS TABLE (slug text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.slug FROM app.stores s
     WHERE s.custom_domain = lower(p_host) AND s.domain_verified_at IS NOT NULL AND s.status = 'active'
  $$;

-- Whether another store already claimed a domain (verified or not); says nothing else.
CREATE FUNCTION app.store_domain_taken(p_host text, p_store uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM app.stores WHERE custom_domain = lower(p_host) AND id <> p_store) $$;

REVOKE ALL ON FUNCTION app.resolve_store_domain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.store_domain_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_store_domain(text) TO wec_public, wec_api;
GRANT EXECUTE ON FUNCTION app.store_domain_taken(text, uuid) TO wec_api;
