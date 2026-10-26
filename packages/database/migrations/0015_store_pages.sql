-- Content pages: About us, shipping and returns policies, contact and so on,
-- shown at /s/<store>/pages/<handle>. The body is light Markdown (headings,
-- lists, bold, italic, links), rendered by the storefront as text, never HTML.
-- Shoppers see published pages only.

CREATE TABLE app.store_pages (
  id              uuid NOT NULL DEFAULT uuidv7(),
  store_id        uuid NOT NULL REFERENCES app.stores (id),
  handle          text NOT NULL CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(handle) <= 100),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 50000),
  seo_title       text CHECK (char_length(seo_title) <= 70),
  seo_description text CHECK (char_length(seo_description) <= 320),
  published       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (store_id, handle)
);

CREATE TRIGGER store_pages_set_updated_at BEFORE UPDATE ON app.store_pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.store_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON app.store_pages USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id());
-- On top of store isolation: the storefront's role sees published pages only.
CREATE POLICY published_only ON app.store_pages AS RESTRICTIVE FOR SELECT TO wec_public USING (published);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.store_pages TO wec_api;
GRANT SELECT (store_id, handle, title, body, seo_title, seo_description, published, updated_at) ON app.store_pages TO wec_public;
