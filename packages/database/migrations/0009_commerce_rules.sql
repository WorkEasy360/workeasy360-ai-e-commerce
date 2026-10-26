-- Commerce rules: offers, shipping zones and rates, tax, bookings and digital downloads.

-- Offers ---------------------------------------------------------------------------------------
-- A discount is either a code shoppers enter or an automatic one applied to
-- every qualifying cart. Usage is counted as orders are placed (and given
-- back when an order is cancelled), under a row lock, so a limited offer
-- can't be overspent by shoppers checking out at the same moment.

CREATE TABLE app.discounts (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  store_id           uuid NOT NULL REFERENCES app.stores (id),
  method             text NOT NULL CHECK (method IN ('code', 'automatic')),
  code               text CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  type               text NOT NULL CHECK (type IN ('percentage', 'fixed', 'free_shipping')),
  -- Percentage: basis points (1 to 10000). Fixed: minor units. Free shipping: 0.
  value              bigint NOT NULL CHECK (value >= 0),
  min_subtotal_minor bigint CHECK (min_subtotal_minor >= 0),
  applies_to         text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'collections', 'products')),
  target_ids         uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(target_ids) <= 100),
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  usage_limit        integer CHECK (usage_limit BETWEEN 1 AND 1000000),
  once_per_customer  boolean NOT NULL DEFAULT false,
  usage_count        integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  enabled            boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  CHECK ((method = 'code') = (code IS NOT NULL)),
  CHECK (type <> 'percentage' OR value BETWEEN 1 AND 10000),
  CHECK (type <> 'fixed' OR value >= 1),
  CHECK (type <> 'free_shipping' OR value = 0),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((applies_to = 'all') = (cardinality(target_ids) = 0))
);

CREATE UNIQUE INDEX discounts_code_idx ON app.discounts (store_id, code) WHERE code IS NOT NULL;
CREATE INDEX discounts_store_idx ON app.discounts (store_id, created_at DESC);

CREATE TRIGGER discounts_set_updated_at BEFORE UPDATE ON app.discounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.discount_redemptions (
  store_id     uuid NOT NULL,
  discount_id  uuid NOT NULL,
  order_id     uuid NOT NULL,
  customer_id  uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (discount_id, order_id),
  FOREIGN KEY (store_id, discount_id) REFERENCES app.discounts (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, customer_id) REFERENCES app.customers (store_id, id)
);

CREATE INDEX discount_redemptions_customer_idx ON app.discount_redemptions (discount_id, customer_id);

-- Shipping ------------------------------------------------------------------------------------
-- Zones are matched in the merchant's order: the first zone covering the
-- address wins, so specific zones (a city's PIN codes) go above broad ones.
-- A store with no zones keeps the flat delivery fee from checkout settings.

CREATE TABLE app.shipping_zones (
  id              uuid NOT NULL DEFAULT uuidv7(),
  store_id        uuid NOT NULL REFERENCES app.stores (id),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  countries       text[] NOT NULL CHECK (cardinality(countries) BETWEEN 1 AND 250),
  regions         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(regions) <= 100),
  postal_prefixes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(postal_prefixes) <= 500),
  cod_enabled     boolean NOT NULL DEFAULT true,
  position        smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 99),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id)
);

CREATE TRIGGER shipping_zones_set_updated_at BEFORE UPDATE ON app.shipping_zones
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.shipping_rates (
  id              uuid NOT NULL DEFAULT uuidv7(),
  store_id        uuid NOT NULL,
  zone_id         uuid NOT NULL,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- flat: always offered. weight: parcel grams in [min, max]. price: subtotal in [min, max].
  kind            text NOT NULL CHECK (kind IN ('flat', 'weight', 'price')),
  min_value       bigint CHECK (min_value >= 0),
  max_value       bigint CHECK (max_value >= 0),
  price_minor     bigint NOT NULL CHECK (price_minor >= 0),
  free_over_minor bigint CHECK (free_over_minor >= 0),
  delivery_time   text CHECK (char_length(delivery_time) <= 60),
  position        smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 49),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, zone_id) REFERENCES app.shipping_zones (store_id, id) ON DELETE CASCADE,
  CHECK (kind <> 'flat' OR (min_value IS NULL AND max_value IS NULL)),
  CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value)
);

CREATE INDEX shipping_rates_zone_idx ON app.shipping_rates (zone_id, position);

-- Tax -----------------------------------------------------------------------------------------

CREATE TABLE app.tax_settings (
  store_id            uuid PRIMARY KEY REFERENCES app.stores (id),
  enabled             boolean NOT NULL DEFAULT false,
  prices_include_tax  boolean NOT NULL DEFAULT true,
  default_rate_bps    integer NOT NULL DEFAULT 0 CHECK (default_rate_bps BETWEEN 0 AND 5000),
  tax_shipping        boolean NOT NULL DEFAULT false,
  label               text NOT NULL DEFAULT 'GST' CHECK (char_length(label) BETWEEN 1 AND 20),
  -- GSTIN or VAT number, printed on invoices.
  registration_number text CHECK (char_length(registration_number) <= 30),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tax_settings_set_updated_at BEFORE UPDATE ON app.tax_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A product's own rate (e.g. 5% GST on tea, 18% on a mug); null uses the store's default.
ALTER TABLE app.products ADD COLUMN tax_rate_bps integer CHECK (tax_rate_bps BETWEEN 0 AND 5000);

-- Orders remember what was applied --------------------------------------------------------------

ALTER TABLE app.orders
  ADD COLUMN discount_minor     bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  ADD COLUMN discount_code      text CHECK (char_length(discount_code) <= 32),
  ADD COLUMN discount_title     text CHECK (char_length(discount_title) <= 100),
  ADD COLUMN tax_minor          bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  ADD COLUMN prices_include_tax boolean NOT NULL DEFAULT true,
  ADD COLUMN tax_label          text CHECK (char_length(tax_label) <= 20),
  ADD COLUMN shipping_rate_name text CHECK (char_length(shipping_rate_name) <= 100);

-- Replace the total check: discounts come off, tax is added only when prices exclude it.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO STRICT c FROM pg_constraint
   WHERE conrelid = 'app.orders'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%total_minor = (subtotal_minor + delivery_minor)%';
  EXECUTE format('ALTER TABLE app.orders DROP CONSTRAINT %I', c);
END $$;

ALTER TABLE app.orders ADD CONSTRAINT orders_total_check
  CHECK (total_minor = subtotal_minor - discount_minor + delivery_minor + CASE WHEN prices_include_tax THEN 0 ELSE tax_minor END);
ALTER TABLE app.orders ADD CONSTRAINT orders_discount_check CHECK (discount_minor <= subtotal_minor);

ALTER TABLE app.order_items
  ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  ADD COLUMN tax_minor      bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  ADD COLUMN tax_rate_bps   integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 5000),
  ADD CONSTRAINT order_items_discount_check CHECK (discount_minor <= total_minor);

-- Bookings ------------------------------------------------------------------------------------
-- Weekly hours for a service, in the store's time zone:
-- {"mon": [["09:00", "18:00"]], ...}. Null: the default hours.
ALTER TABLE app.products ADD COLUMN booking_hours jsonb
  CHECK (booking_hours IS NULL OR (jsonb_typeof(booking_hours) = 'object' AND octet_length(booking_hours::text) <= 2048));

-- Counting bookings per slot.
CREATE INDEX order_items_booking_idx ON app.order_items (product_id, booking_at) WHERE booking_at IS NOT NULL;

-- Digital downloads -----------------------------------------------------------------------------
-- One grant per file of each digital item, created when the order is paid.
-- The shopper's order page (reached with the order's secret link) lists
-- them; each download counts against the product's limit and expiry.

CREATE TABLE app.download_grants (
  id             uuid NOT NULL DEFAULT uuidv7(),
  store_id       uuid NOT NULL,
  order_id       uuid NOT NULL,
  order_item_id  uuid NOT NULL,
  media_id       uuid NOT NULL,
  file_name      text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  download_limit integer CHECK (download_limit BETWEEN 1 AND 100),
  downloads_used integer NOT NULL DEFAULT 0 CHECK (downloads_used >= 0),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (order_item_id, media_id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, media_id) REFERENCES app.media_assets (store_id, id) ON DELETE CASCADE,
  CHECK (download_limit IS NULL OR downloads_used <= download_limit)
);

CREATE INDEX download_grants_order_idx ON app.download_grants (order_id);

-- Row security and grants -------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['discounts', 'discount_redemptions', 'shipping_zones', 'shipping_rates', 'tax_settings', 'download_grants'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.discounts, app.shipping_zones, app.shipping_rates, app.tax_settings TO wec_api;
GRANT SELECT, INSERT, DELETE ON app.discount_redemptions TO wec_api;
GRANT SELECT, INSERT ON app.download_grants TO wec_api;
GRANT UPDATE (downloads_used, revoked_at) ON app.download_grants TO wec_api;

-- The worker cancels unpaid card orders: their discount use is given back and downloads revoked.
GRANT SELECT ON app.discounts, app.discount_redemptions, app.download_grants TO wec_worker;
GRANT UPDATE (usage_count) ON app.discounts TO wec_worker;
GRANT DELETE ON app.discount_redemptions TO wec_worker;
GRANT UPDATE (revoked_at) ON app.download_grants TO wec_worker;
