-- Storefront reads, checkout settings, customers and orders (docs/02-data-model.md).
--
-- Shoppers browse through the public role. The API sets the store context
-- from the shop's address (never from request input), and RESTRICTIVE
-- policies narrow what that role sees within it to what is on sale: active
-- products, their variants and options, ready public media and published
-- collections. Placing an order runs as the API role in the same resolved
-- store context, so the public role never writes.

-- Storefront read access ---------------------------------------------------------

GRANT SELECT ON app.products, app.product_options, app.variants, app.product_media, app.media_assets,
  app.collections, app.collection_products, app.inventory_levels TO wec_public;

CREATE POLICY storefront_on_sale ON app.products AS RESTRICTIVE FOR SELECT TO wec_public
  USING (status = 'active');
CREATE POLICY storefront_on_sale ON app.variants AS RESTRICTIVE FOR SELECT TO wec_public
  USING (EXISTS (SELECT 1 FROM app.products p WHERE p.id = variants.product_id));
CREATE POLICY storefront_on_sale ON app.product_options AS RESTRICTIVE FOR SELECT TO wec_public
  USING (EXISTS (SELECT 1 FROM app.products p WHERE p.id = product_options.product_id));
CREATE POLICY storefront_on_sale ON app.product_media AS RESTRICTIVE FOR SELECT TO wec_public
  USING (EXISTS (SELECT 1 FROM app.products p WHERE p.id = product_media.product_id));
CREATE POLICY storefront_on_sale ON app.media_assets AS RESTRICTIVE FOR SELECT TO wec_public
  USING (status = 'ready' AND visibility = 'public');
CREATE POLICY storefront_on_sale ON app.collections AS RESTRICTIVE FOR SELECT TO wec_public
  USING (published);
CREATE POLICY storefront_on_sale ON app.collection_products AS RESTRICTIVE FOR SELECT TO wec_public
  USING (EXISTS (SELECT 1 FROM app.products p WHERE p.id = collection_products.product_id));
CREATE POLICY storefront_on_sale ON app.inventory_levels AS RESTRICTIVE FOR SELECT TO wec_public
  USING (EXISTS (SELECT 1 FROM app.variants v WHERE v.id = inventory_levels.variant_id));

-- Checkout settings --------------------------------------------------------------------
-- How a store takes orders before card gateways arrive: delivery charges,
-- offline payment methods with the merchant's own instructions, and chat
-- ordering. One row per store, created on first save.

CREATE TABLE app.checkout_settings (
  store_id               uuid PRIMARY KEY REFERENCES app.stores (id),
  delivery_enabled       boolean NOT NULL DEFAULT true,
  delivery_fee_minor     bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  free_delivery_over_minor bigint CHECK (free_delivery_over_minor >= 0),
  pickup_enabled         boolean NOT NULL DEFAULT false,
  pickup_address         text CHECK (char_length(pickup_address) <= 500),
  cod_enabled            boolean NOT NULL DEFAULT true,
  cod_instructions       text CHECK (char_length(cod_instructions) <= 1000),
  bank_enabled           boolean NOT NULL DEFAULT false,
  bank_instructions      text CHECK (char_length(bank_instructions) <= 2000),
  upi_enabled            boolean NOT NULL DEFAULT false,
  upi_id                 text CHECK (upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$'),
  upi_instructions       text CHECK (char_length(upi_instructions) <= 1000),
  whatsapp_number        text CHECK (whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  telegram_username      text CHECK (telegram_username ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$'),
  order_note_enabled     boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT bank_enabled OR bank_instructions IS NOT NULL),
  CHECK (NOT upi_enabled OR upi_id IS NOT NULL),
  CHECK (NOT pickup_enabled OR pickup_address IS NOT NULL)
);

CREATE TRIGGER checkout_settings_set_updated_at BEFORE UPDATE ON app.checkout_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- customers --------------------------------------------------------------------------------
-- One row per email address within a store, kept in step by checkout.

CREATE TABLE app.customers (
  id         uuid NOT NULL DEFAULT uuidv7(),
  store_id   uuid NOT NULL REFERENCES app.stores (id),
  email      text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  phone      text CHECK (char_length(phone) <= 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (store_id, email)
);

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON app.customers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- orders ---------------------------------------------------------------------------------------
-- Line items snapshot what was bought (title, option values, price), so an
-- order reads the same after the product changes or is deleted. Shoppers
-- reach their order page with a random token; only its hash is stored.

CREATE TABLE app.order_counters (
  store_id    uuid PRIMARY KEY REFERENCES app.stores (id),
  last_number integer NOT NULL DEFAULT 1000 CHECK (last_number >= 1000)
);

CREATE TABLE app.orders (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  store_id           uuid NOT NULL REFERENCES app.stores (id),
  number             integer NOT NULL CHECK (number > 1000),
  token_hash         bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  payment_status     text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled', 'fulfilled')),
  payment_method     text NOT NULL CHECK (payment_method IN ('cod', 'bank', 'upi', 'whatsapp', 'telegram')),
  delivery_method    text NOT NULL CHECK (delivery_method IN ('delivery', 'pickup', 'none')),
  customer_id        uuid NOT NULL,
  email              text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  phone              text CHECK (char_length(phone) <= 30),
  -- {line1, line2, city, state, postalCode, country}
  shipping_address   jsonb CHECK (shipping_address IS NULL OR (jsonb_typeof(shipping_address) = 'object' AND octet_length(shipping_address::text) <= 2048)),
  note               text CHECK (char_length(note) <= 1000),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor     bigint NOT NULL CHECK (subtotal_minor >= 0),
  delivery_minor     bigint NOT NULL DEFAULT 0 CHECK (delivery_minor >= 0),
  total_minor        bigint NOT NULL CHECK (total_minor >= 0),
  placed_at          timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  fulfilled_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  UNIQUE (store_id, number),
  FOREIGN KEY (store_id, customer_id) REFERENCES app.customers (store_id, id),
  CHECK ((delivery_method = 'delivery') = (shipping_address IS NOT NULL)),
  CHECK ((payment_status = 'paid') = (paid_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (total_minor = subtotal_minor + delivery_minor)
);

CREATE INDEX orders_store_placed_idx ON app.orders (store_id, placed_at DESC, id DESC);
CREATE INDEX orders_customer_idx ON app.orders (customer_id);

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.order_items (
  id               uuid NOT NULL DEFAULT uuidv7(),
  store_id         uuid NOT NULL,
  order_id         uuid NOT NULL,
  product_id       uuid,
  variant_id       uuid,
  product_type     text NOT NULL CHECK (product_type IN ('physical', 'digital', 'service')),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  variant_title    text CHECK (char_length(variant_title) <= 200),
  sku              text CHECK (char_length(sku) <= 64),
  image_media_id   uuid,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  quantity         integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  total_minor      bigint NOT NULL CHECK (total_minor = unit_price_minor * quantity),
  -- Bookable services: the slot the shopper asked for.
  booking_at       timestamptz,
  -- Whether stock was taken for this line (and must come back on cancel).
  stock_taken      boolean NOT NULL DEFAULT false,
  position         smallint NOT NULL CHECK (position BETWEEN 0 AND 99),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE,
  -- Keep the line if the product or variant is deleted later.
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE SET NULL (product_id),
  FOREIGN KEY (store_id, variant_id) REFERENCES app.variants (store_id, id) ON DELETE SET NULL (variant_id),
  CHECK (product_type <> 'service' OR booking_at IS NOT NULL OR product_id IS NULL)
);

CREATE INDEX order_items_order_idx ON app.order_items (order_id, position);
CREATE INDEX order_items_product_idx ON app.order_items (product_id);

-- The order's timeline: placement, payments, fulfilment, cancellation, notes.
CREATE TABLE app.order_events (
  id         uuid NOT NULL DEFAULT uuidv7(),
  store_id   uuid NOT NULL,
  order_id   uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('placed', 'paid', 'fulfilled', 'cancelled', 'note', 'email_sent')),
  message    text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  actor_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE
);

CREATE INDEX order_events_order_idx ON app.order_events (order_id, created_at, id);

CREATE TRIGGER order_events_append_only BEFORE UPDATE ON app.order_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_update();

-- Stock movements now name the order that caused them, and orders can give stock back.
ALTER TABLE app.inventory_movements ADD COLUMN order_id uuid;
ALTER TABLE app.inventory_movements DROP CONSTRAINT inventory_movements_reason_check;
ALTER TABLE app.inventory_movements ADD CONSTRAINT inventory_movements_reason_check
  CHECK (reason IN ('initial', 'received', 'correction', 'damaged', 'returned', 'sold', 'import', 'cancelled'));

-- Row security ------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checkout_settings', 'customers', 'order_counters', 'orders', 'order_items', 'order_events'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END
$$;

-- Privileges -------------------------------------------------------------------------------
-- Orders are records: never deleted by runtime roles. Events are append-only.

GRANT SELECT, INSERT, UPDATE ON app.checkout_settings, app.customers, app.order_counters TO wec_api;
GRANT SELECT, INSERT ON app.orders, app.order_items, app.order_events TO wec_api;
GRANT UPDATE (status, payment_status, fulfillment_status, paid_at, fulfilled_at, cancelled_at, updated_at) ON app.orders TO wec_api;
GRANT UPDATE (stock_taken) ON app.order_items TO wec_api;
-- The storefront shows the shop's checkout options.
GRANT SELECT ON app.checkout_settings TO wec_public;
-- The worker sends order emails.
GRANT SELECT ON app.stores, app.checkout_settings, app.orders, app.order_items TO wec_worker;
GRANT INSERT ON app.order_events TO wec_worker;
