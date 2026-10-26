-- AI Studio and Store Design.

-- AI Studio -------------------------------------------------------------------------------------
-- A generation is a request (task, target, inputs) worked by the worker into
-- a proposal. Nothing in the store changes until the merchant applies it.
-- Usage is counted per store per day, and checked before a request is queued.

CREATE TABLE app.ai_generations (
  id            uuid NOT NULL DEFAULT uuidv7(),
  store_id      uuid NOT NULL REFERENCES app.stores (id),
  task          text NOT NULL CHECK (task IN ('product_copy', 'collection_copy', 'review_summary', 'sales_insights')),
  target_type   text CHECK (target_type IN ('product', 'collection')),
  target_id     uuid,
  input         jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 32768),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  output        jsonb CHECK (output IS NULL OR octet_length(output::text) <= 32768),
  error_code    text CHECK (error_code ~ '^[a-z][a-z_]*$'),
  provider      text CHECK (char_length(provider) <= 40),
  model         text CHECK (char_length(model) <= 100),
  input_tokens  integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  applied_at    timestamptz,
  applied_by    uuid,
  discarded_at  timestamptz,
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK ((status = 'succeeded') = (output IS NOT NULL)),
  CHECK (applied_at IS NULL OR status = 'succeeded')
);

CREATE INDEX ai_generations_store_idx ON app.ai_generations (store_id, created_at DESC);
CREATE INDEX ai_generations_target_idx ON app.ai_generations (target_id, created_at DESC) WHERE target_id IS NOT NULL;

CREATE TABLE app.ai_usage_days (
  store_id    uuid NOT NULL REFERENCES app.stores (id),
  day         date NOT NULL,
  generations integer NOT NULL DEFAULT 0 CHECK (generations >= 0),
  tokens      integer NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  PRIMARY KEY (store_id, day)
);

-- Store Design ---------------------------------------------------------------------------------
-- The merchant edits a draft; shoppers see what was last published.
-- Both are validated theme documents (see packages/commerce/src/theme.ts).

CREATE TABLE app.store_themes (
  store_id     uuid PRIMARY KEY REFERENCES app.stores (id),
  draft        jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 65536),
  published    jsonb CHECK (published IS NULL OR (jsonb_typeof(published) = 'object' AND octet_length(published::text) <= 65536)),
  published_at timestamptz,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((published IS NULL) = (published_at IS NULL))
);

CREATE TRIGGER store_themes_set_updated_at BEFORE UPDATE ON app.store_themes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Row security and grants -------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_generations', 'ai_usage_days', 'store_themes'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON app.ai_generations TO wec_api;
GRANT UPDATE (applied_at, applied_by, discarded_at) ON app.ai_generations TO wec_api;
GRANT SELECT, INSERT, UPDATE ON app.ai_usage_days TO wec_api;
GRANT SELECT, INSERT, UPDATE ON app.store_themes TO wec_api;

GRANT SELECT ON app.ai_generations TO wec_worker;
GRANT UPDATE (status, output, error_code, provider, model, input_tokens, output_tokens, finished_at) ON app.ai_generations TO wec_worker;
GRANT SELECT, INSERT, UPDATE ON app.ai_usage_days TO wec_worker;

-- Shoppers see the published theme only; drafts stay with the merchant.
GRANT SELECT (store_id, published) ON app.store_themes TO wec_public;
