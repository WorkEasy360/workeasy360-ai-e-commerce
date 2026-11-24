-- WorkEasy360 Accounts sign-in for the merchant admin (docs/workeasy360-sso.md).
--
-- WorkEasy360 Accounts is the identity provider of the WorkEasy360 product
-- family. Its ID token names one person (sub), one WorkEasy360 organization
-- (organization_id) and this product (product_code). Here a WorkEasy360
-- organization owns stores: a session opened by WorkEasy360 is bound to the
-- organization its token named and reaches only that organization's stores.
--
-- Platform-level rows (sign-in flows, logout tokens, entitlement answers)
-- belong to no store. Their tables have row security forced and no runtime
-- grants: the API reaches them only through the SECURITY DEFINER functions
-- below, like the identity lookups of 0001.

-- Stores and WorkEasy360 organizations --------------------------------------------

-- The organization that owns the store (several stores may share one); NULL
-- for a store that is not linked to WorkEasy360.
ALTER TABLE app.stores ADD COLUMN workeasy360_organization_id uuid;
CREATE INDEX stores_workeasy360_organization_idx ON app.stores (workeasy360_organization_id)
  WHERE workeasy360_organization_id IS NOT NULL;

-- (The owner already reads every store through store_lookup, 0003.)
CREATE POLICY membership_lookup ON app.memberships FOR SELECT TO wec_owner USING (true);

-- The stores an organization owns, for a WorkEasy360 sign-in.
CREATE FUNCTION app.workeasy360_organization_stores(p_organization_id uuid)
  RETURNS TABLE (store_id uuid, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT s.id, s.status FROM app.stores s WHERE s.workeasy360_organization_id = p_organization_id ORDER BY s.created_at $$;

-- The organization of a store, but only for an active member of it: a
-- non-member learns nothing about a store, not even that it is linked.
CREATE FUNCTION app.member_store_workeasy360_org(p_store_id uuid, p_user_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.workeasy360_organization_id
      FROM app.stores s
      JOIN app.memberships m ON m.store_id = s.id
     WHERE s.id = p_store_id
       AND m.user_id = p_user_id
       AND m.status = 'active'
  $$;

-- The organization of the store an invitation is for (the caller holds the invitation).
CREATE FUNCTION app.store_workeasy360_org(p_store_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT s.workeasy360_organization_id FROM app.stores s WHERE s.id = p_store_id $$;

-- Users with this subject under another issuer: a WorkEasy360 sign-in that
-- would otherwise split one person into two accounts after an issuer move.
CREATE FUNCTION app.find_issuers_for_subject(p_subject text)
  RETURNS TABLE (issuer text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT u.issuer FROM app.users u WHERE u.subject = p_subject $$;

REVOKE ALL ON FUNCTION app.workeasy360_organization_stores(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.member_store_workeasy360_org(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.store_workeasy360_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.find_issuers_for_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workeasy360_organization_stores(uuid), app.member_store_workeasy360_org(uuid, uuid),
  app.store_workeasy360_org(uuid), app.find_issuers_for_subject(text) TO wec_api;

-- Sessions ------------------------------------------------------------------------

ALTER TABLE app.auth_sessions
  ADD COLUMN provider             text NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'workeasy360')),
  ADD COLUMN w360_issuer          text CHECK (char_length(w360_issuer) BETWEEN 1 AND 500),
  ADD COLUMN w360_subject         text CHECK (char_length(w360_subject) BETWEEN 1 AND 255),
  ADD COLUMN w360_sid             text CHECK (char_length(w360_sid) BETWEEN 1 AND 255),
  ADD COLUMN w360_organization_id uuid,
  -- Kept only to send as id_token_hint when the person also signs out of WorkEasy360.
  ADD COLUMN id_token             text CHECK (char_length(id_token) <= 16384),
  ADD CONSTRAINT auth_sessions_provider_shape CHECK (
    (provider = 'local'
      AND w360_issuer IS NULL AND w360_subject IS NULL AND w360_sid IS NULL
      AND w360_organization_id IS NULL AND id_token IS NULL)
    OR
    (provider = 'workeasy360'
      AND w360_issuer IS NOT NULL AND w360_subject IS NOT NULL AND w360_organization_id IS NOT NULL)
  );

CREATE INDEX auth_sessions_w360_sid_idx ON app.auth_sessions (w360_issuer, w360_sid)
  WHERE w360_sid IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX auth_sessions_w360_subject_idx ON app.auth_sessions (w360_issuer, w360_subject)
  WHERE provider = 'workeasy360' AND revoked_at IS NULL;

-- The per-request check also says how the session was opened and, for a
-- WorkEasy360 session, its organization and person. Still one indexed read of
-- PostgreSQL per request with nothing cached in a process, so a session ended
-- on one instance is refused by every instance on its next request.
DROP FUNCTION app.resolve_session(bytea);
CREATE FUNCTION app.resolve_session(p_token_hash bytea)
  RETURNS TABLE (session_id uuid, user_id uuid, expires_at timestamptz, provider text, w360_organization_id uuid, w360_subject text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.id, s.user_id, s.expires_at, s.provider, s.w360_organization_id, s.w360_subject
      FROM app.auth_sessions s
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION app.resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_session(bytea) TO wec_api;

-- Sign-in flows -------------------------------------------------------------------

-- State, nonce and PKCE verifier stay on the server; the browser holds only a
-- random id (its SHA-256 is the key). Taken (deleted) by the callback whatever
-- happens next, so each is used once.
CREATE TABLE app.workeasy360_login_flows (
  id_hash         bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  state           text NOT NULL CHECK (char_length(state) BETWEEN 16 AND 200),
  nonce           text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 200),
  code_verifier   text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  organization_id uuid,
  return_to       text CHECK (char_length(return_to) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX workeasy360_login_flows_expires_idx ON app.workeasy360_login_flows (expires_at);

ALTER TABLE app.workeasy360_login_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workeasy360_login_flows FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app.workeasy360_login_flows TO wec_owner USING (true) WITH CHECK (true);

CREATE FUNCTION app.workeasy360_save_login_flow(
  p_id_hash bytea, p_state text, p_nonce text, p_code_verifier text,
  p_organization_id uuid, p_return_to text, p_ttl_seconds integer
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
BEGIN
  -- Abandoned flows go a few at a time, so the table stays small without a job.
  DELETE FROM app.workeasy360_login_flows
   WHERE id_hash IN (SELECT f.id_hash FROM app.workeasy360_login_flows f WHERE f.expires_at < now() LIMIT 100);
  INSERT INTO app.workeasy360_login_flows (id_hash, state, nonce, code_verifier, organization_id, return_to, expires_at)
  VALUES (p_id_hash, p_state, p_nonce, p_code_verifier, p_organization_id, p_return_to,
          now() + make_interval(secs => LEAST(GREATEST(p_ttl_seconds, 60), 900)));
END
$$;

CREATE FUNCTION app.workeasy360_take_login_flow(p_id_hash bytea)
  RETURNS TABLE (state text, nonce text, code_verifier text, organization_id uuid, return_to text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    WITH taken AS (
      DELETE FROM app.workeasy360_login_flows f WHERE f.id_hash = p_id_hash
      RETURNING f.state, f.nonce, f.code_verifier, f.organization_id, f.return_to, f.expires_at
    )
    SELECT t.state, t.nonce, t.code_verifier, t.organization_id, t.return_to FROM taken t WHERE t.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION app.workeasy360_save_login_flow(bytea, text, text, text, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.workeasy360_take_login_flow(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workeasy360_save_login_flow(bytea, text, text, text, uuid, text, integer),
  app.workeasy360_take_login_flow(bytea) TO wec_api;

-- Back-channel logout -------------------------------------------------------------

CREATE TABLE app.workeasy360_logout_tokens (
  issuer      text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 500),
  jti         text NOT NULL CHECK (char_length(jti) BETWEEN 1 AND 255),
  expires_at  timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, jti)
);

CREATE INDEX workeasy360_logout_tokens_expires_idx ON app.workeasy360_logout_tokens (expires_at);

ALTER TABLE app.workeasy360_logout_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workeasy360_logout_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app.workeasy360_logout_tokens TO wec_owner USING (true) WITH CHECK (true);

-- Ending sessions is a platform-level write: the token names a person or a sign-in, never a store.
CREATE POLICY session_end ON app.auth_sessions FOR UPDATE TO wec_owner USING (true) WITH CHECK (true);

-- Records the jti and ends the sessions a verified logout token names, in one
-- transaction (nothing happened if anything fails, so a retry is not a replay):
--   * with sid: the sessions that provider sign-in opened (only that person's
--     when the token also names sub);
--   * with sub only: every session of that person.
CREATE FUNCTION app.workeasy360_end_sessions(
  p_issuer text, p_jti text, p_acceptable_until timestamptz, p_subject text, p_sid text
) RETURNS TABLE (replayed boolean, sessions_ended integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
DECLARE
  ended integer := 0;
BEGIN
  IF p_subject IS NULL AND p_sid IS NULL THEN
    RAISE EXCEPTION 'a logout token names sub, sid or both';
  END IF;

  INSERT INTO app.workeasy360_logout_tokens (issuer, jti, expires_at)
  VALUES (p_issuer, p_jti, p_acceptable_until)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF p_sid IS NOT NULL THEN
    UPDATE app.auth_sessions s
       SET revoked_at = now()
     WHERE s.revoked_at IS NULL
       AND s.provider = 'workeasy360'
       AND s.w360_issuer = p_issuer
       AND s.w360_sid = p_sid
       AND (p_subject IS NULL OR s.w360_subject = p_subject);
  ELSE
    UPDATE app.auth_sessions s
       SET revoked_at = now()
     WHERE s.revoked_at IS NULL
       AND (
         (s.provider = 'workeasy360' AND s.w360_issuer = p_issuer AND s.w360_subject = p_subject)
         OR s.user_id IN (SELECT u.id FROM app.users u WHERE u.issuer = p_issuer AND u.subject = p_subject)
       );
  END IF;
  GET DIAGNOSTICS ended = ROW_COUNT;

  DELETE FROM app.workeasy360_logout_tokens
   WHERE (issuer, jti) IN (
     SELECT t.issuer, t.jti FROM app.workeasy360_logout_tokens t WHERE t.expires_at < now() LIMIT 100
   );

  RETURN QUERY SELECT false, ended;
END
$$;

REVOKE ALL ON FUNCTION app.workeasy360_end_sessions(text, text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workeasy360_end_sessions(text, text, timestamptz, text, text) TO wec_api;

-- Entitlement answers -------------------------------------------------------------

-- The last entitlement answer per organization (and person), shared by every
-- API instance. An allow expires; a known denial is kept without expiry.
CREATE TABLE app.workeasy360_entitlements (
  cache_key  text PRIMARY KEY CHECK (char_length(cache_key) BETWEEN 1 AND 200),
  answer     jsonb NOT NULL CHECK (jsonb_typeof(answer) = 'object'),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.workeasy360_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workeasy360_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app.workeasy360_entitlements TO wec_owner USING (true) WITH CHECK (true);

CREATE FUNCTION app.workeasy360_entitlement_get(p_key text)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT e.answer FROM app.workeasy360_entitlements e
     WHERE e.cache_key = p_key AND (e.expires_at IS NULL OR e.expires_at > now())
  $$;

CREATE FUNCTION app.workeasy360_entitlement_put(p_key text, p_answer jsonb, p_ttl_seconds integer)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    INSERT INTO app.workeasy360_entitlements AS e (cache_key, answer, expires_at)
    VALUES (p_key, p_answer, CASE WHEN p_ttl_seconds IS NULL THEN NULL ELSE now() + make_interval(secs => p_ttl_seconds) END)
    ON CONFLICT (cache_key) DO UPDATE
      SET answer = EXCLUDED.answer, expires_at = EXCLUDED.expires_at, updated_at = now()
  $$;

REVOKE ALL ON FUNCTION app.workeasy360_entitlement_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.workeasy360_entitlement_put(text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workeasy360_entitlement_get(text), app.workeasy360_entitlement_put(text, jsonb, integer) TO wec_api;
