-- Catalog: media, products with options and variants, collections and the
-- inventory ledger (docs/02-data-model.md).
--
-- Every table carries store_id with FORCEd row security. Child rows reference
-- their parent through (store_id, id) pairs, so a row can never point at
-- another store's product, variant or file. Money is integer minor units in
-- the store's currency.

-- media_assets ---------------------------------------------------------------
-- Files uploaded to the Media Library. A browser uploads straight to the
-- quarantine bucket; the worker checks size, type and malware, then moves the
-- object to the media bucket and marks it ready. Public assets (product and
-- collection images) are served to anyone through a redirect; private ones
-- (digital products' files) only through signed downloads.

CREATE TABLE app.media_assets (
  id            uuid NOT NULL DEFAULT uuidv7(),
  store_id      uuid NOT NULL REFERENCES app.stores (id),
  kind          text NOT NULL CHECK (kind IN ('image', 'video', 'file')),
  visibility    text NOT NULL CHECK (visibility IN ('public', 'private')),
  status        text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'scanning', 'ready', 'rejected')),
  -- Display name only; never part of the storage key.
  filename      text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  declared_type text NOT NULL CHECK (char_length(declared_type) BETWEEN 3 AND 100),
  content_type  text CHECK (char_length(content_type) <= 100),
  byte_size     bigint NOT NULL CHECK (byte_size > 0),
  width         integer CHECK (width > 0),
  height        integer CHECK (height > 0),
  alt_text      text NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 500),
  folder        text NOT NULL DEFAULT '' CHECK (char_length(folder) <= 100),
  storage_key   text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 10 AND 300),
  reject_reason text CHECK (reject_reason ~ '^[a-z][a-z_]*$'),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  CHECK (kind <> 'file' OR visibility = 'private')
);

CREATE INDEX media_assets_store_created_idx ON app.media_assets (store_id, created_at DESC, id DESC);

CREATE TRIGGER media_assets_set_updated_at BEFORE UPDATE ON app.media_assets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- products ---------------------------------------------------------------------

CREATE TABLE app.products (
  id                       uuid NOT NULL DEFAULT uuidv7(),
  store_id                 uuid NOT NULL REFERENCES app.stores (id),
  type                     text NOT NULL CHECK (type IN ('physical', 'digital', 'service')),
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  title                    text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  handle                   text NOT NULL CHECK (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,98}[a-z0-9]?$'),
  description              text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  vendor                   text CHECK (char_length(vendor) <= 100),
  tags                     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 50),
  seo_title                text CHECK (char_length(seo_title) <= 120),
  seo_description          text CHECK (char_length(seo_description) <= 320),
  -- Digital products: how often and for how long a buyer's download link works (null: no limit).
  download_limit           integer CHECK (download_limit BETWEEN 1 AND 100),
  download_expiry_days     integer CHECK (download_expiry_days BETWEEN 1 AND 3650),
  -- Bookable services: length of one booking, minimum notice, and bookings per slot.
  booking_duration_minutes integer CHECK (booking_duration_minutes BETWEEN 5 AND 1440),
  booking_notice_hours     integer CHECK (booking_notice_hours BETWEEN 0 AND 2160),
  booking_capacity         integer CHECK (booking_capacity BETWEEN 1 AND 1000),
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (store_id, handle),
  CHECK (type = 'service' OR (booking_duration_minutes IS NULL AND booking_notice_hours IS NULL AND booking_capacity IS NULL)),
  CHECK (type = 'digital' OR (download_limit IS NULL AND download_expiry_days IS NULL))
);

CREATE INDEX products_store_updated_idx ON app.products (store_id, updated_at DESC, id DESC);
CREATE INDEX products_tags_idx ON app.products USING gin (tags);

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON app.products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Options (Size, Colour…) in order; each variant lists one value per option.
CREATE TABLE app.product_options (
  store_id   uuid NOT NULL,
  product_id uuid NOT NULL,
  position   smallint NOT NULL CHECK (position BETWEEN 0 AND 2),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  "values"   text[] NOT NULL CHECK (cardinality("values") BETWEEN 1 AND 50),
  PRIMARY KEY (product_id, position),
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE
);

CREATE TABLE app.variants (
  id               uuid NOT NULL DEFAULT uuidv7(),
  store_id         uuid NOT NULL,
  product_id       uuid NOT NULL,
  position         smallint NOT NULL CHECK (position BETWEEN 0 AND 99),
  options          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(options) <= 3),
  sku              text CHECK (char_length(sku) BETWEEN 1 AND 64),
  barcode          text CHECK (char_length(barcode) BETWEEN 1 AND 64),
  price_minor      bigint NOT NULL CHECK (price_minor >= 0),
  compare_at_minor bigint CHECK (compare_at_minor >= 0),
  cost_minor       bigint CHECK (cost_minor >= 0),
  weight_grams     integer CHECK (weight_grams BETWEEN 0 AND 1000000),
  track_inventory  boolean NOT NULL DEFAULT true,
  allow_backorder  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (product_id, options),
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE
);

CREATE INDEX variants_product_idx ON app.variants (product_id, position);
-- SKUs are unique within a store when set, so stock counts and imports can rely on them.
CREATE UNIQUE INDEX variants_store_sku_idx ON app.variants (store_id, lower(sku)) WHERE sku IS NOT NULL;

CREATE TRIGGER variants_set_updated_at BEFORE UPDATE ON app.variants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Product images and videos, in display order.
CREATE TABLE app.product_media (
  store_id   uuid NOT NULL,
  product_id uuid NOT NULL,
  media_id   uuid NOT NULL,
  position   smallint NOT NULL CHECK (position BETWEEN 0 AND 49),
  PRIMARY KEY (product_id, media_id),
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, media_id) REFERENCES app.media_assets (store_id, id) ON DELETE CASCADE
);

CREATE INDEX product_media_media_idx ON app.product_media (media_id);

-- Files a digital product delivers after payment.
CREATE TABLE app.product_files (
  store_id   uuid NOT NULL,
  product_id uuid NOT NULL,
  media_id   uuid NOT NULL,
  position   smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
  PRIMARY KEY (product_id, media_id),
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, media_id) REFERENCES app.media_assets (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX product_files_media_idx ON app.product_files (media_id);

-- collections ----------------------------------------------------------------------
-- Manual collections list their products; automated ones hold rules the API
-- evaluates ({"match":"all","conditions":[{"field":"tag","operator":"equals","value":"summer"}]}).

CREATE TABLE app.collections (
  id              uuid NOT NULL DEFAULT uuidv7(),
  store_id        uuid NOT NULL REFERENCES app.stores (id),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  handle          text NOT NULL CHECK (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,98}[a-z0-9]?$'),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  kind            text NOT NULL CHECK (kind IN ('manual', 'automated')),
  rules           jsonb CHECK (rules IS NULL OR (jsonb_typeof(rules) = 'object' AND octet_length(rules::text) <= 8192)),
  sort_order      text NOT NULL DEFAULT 'manual' CHECK (sort_order IN ('manual', 'newest', 'title', 'price_asc', 'price_desc')),
  image_media_id  uuid,
  published       boolean NOT NULL DEFAULT true,
  seo_title       text CHECK (char_length(seo_title) <= 120),
  seo_description text CHECK (char_length(seo_description) <= 320),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (store_id, handle),
  FOREIGN KEY (store_id, image_media_id) REFERENCES app.media_assets (store_id, id) ON DELETE SET NULL (image_media_id),
  CHECK ((kind = 'automated') = (rules IS NOT NULL)),
  CHECK (kind = 'manual' OR sort_order <> 'manual')
);

CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON app.collections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.collection_products (
  store_id      uuid NOT NULL,
  collection_id uuid NOT NULL,
  product_id    uuid NOT NULL,
  position      integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (collection_id, product_id),
  FOREIGN KEY (store_id, collection_id) REFERENCES app.collections (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE
);

CREATE INDEX collection_products_product_idx ON app.collection_products (product_id);

-- inventory ------------------------------------------------------------------------
-- One level per variant. `reserved` is stock held for shoppers in checkout
-- (phase 3); available = on_hand - reserved. Every change is a movement row,
-- so the history explains the current count.

CREATE TABLE app.inventory_levels (
  store_id            uuid NOT NULL,
  variant_id          uuid NOT NULL PRIMARY KEY,
  on_hand             integer NOT NULL DEFAULT 0 CHECK (on_hand BETWEEN -1000000 AND 1000000000),
  reserved            integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  low_stock_threshold integer CHECK (low_stock_threshold BETWEEN 0 AND 1000000),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, variant_id) REFERENCES app.variants (store_id, id) ON DELETE CASCADE
);

CREATE INDEX inventory_levels_store_idx ON app.inventory_levels (store_id);

CREATE TRIGGER inventory_levels_set_updated_at BEFORE UPDATE ON app.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.inventory_movements (
  id            uuid NOT NULL DEFAULT uuidv7(),
  store_id      uuid NOT NULL,
  variant_id    uuid NOT NULL,
  delta         integer NOT NULL CHECK (delta <> 0),
  on_hand_after integer NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('initial', 'received', 'correction', 'damaged', 'returned', 'sold', 'import')),
  note          text CHECK (char_length(note) <= 500),
  actor_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, variant_id) REFERENCES app.variants (store_id, id) ON DELETE CASCADE
);

CREATE INDEX inventory_movements_variant_idx ON app.inventory_movements (variant_id, created_at DESC, id DESC);

CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE ON app.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app.reject_update();

-- Row security ------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_assets', 'products', 'product_options', 'variants', 'product_media', 'product_files',
                           'collections', 'collection_products', 'inventory_levels', 'inventory_movements'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END
$$;

-- Public media ------------------------------------------------------------------------
-- The storefront and the admin show images through /public/v1/media/<id>,
-- which redirects to a short-lived signed URL. Only ready, public assets
-- resolve; digital products' files never do.

CREATE POLICY media_lookup ON app.media_assets FOR SELECT TO wec_owner USING (true);

CREATE FUNCTION app.resolve_public_media(p_id uuid)
  RETURNS TABLE (storage_key text, content_type text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT m.storage_key, m.content_type FROM app.media_assets m
     WHERE m.id = p_id AND m.status = 'ready' AND m.visibility = 'public'
  $$;

REVOKE ALL ON FUNCTION app.resolve_public_media(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_public_media(uuid) TO wec_public, wec_api;

-- Privileges --------------------------------------------------------------------------
-- Catalog rows are configuration the merchant edits and removes, so the API
-- may delete them. Movements are append-only; media rows are removed by the
-- API only after their stored object is gone.

GRANT SELECT, INSERT, UPDATE, DELETE ON app.media_assets, app.products, app.product_options, app.variants, app.product_media,
  app.product_files, app.collections, app.collection_products, app.inventory_levels TO wec_api;
GRANT SELECT, INSERT ON app.inventory_movements TO wec_api;

-- The worker scans uploads and records the outcome.
GRANT SELECT ON app.media_assets, app.products, app.variants, app.inventory_levels TO wec_worker;
GRANT UPDATE (status, content_type, byte_size, width, height, reject_reason, updated_at) ON app.media_assets TO wec_worker;
