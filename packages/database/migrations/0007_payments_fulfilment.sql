-- Card payments, refunds, fulfilment with tracking, and abandoned checkouts
-- (docs/02-data-model.md).
--
-- Merchants connect their own Razorpay or Stripe account by pasting API keys.
-- Secret keys and webhook secrets are stored encrypted (AES-256-GCM with
-- SECRETS_ENCRYPTION_KEY, held by the API and worker only); the database
-- never sees them in plain text.

-- payment_accounts -------------------------------------------------------------------

CREATE TABLE app.payment_accounts (
  store_id              uuid NOT NULL REFERENCES app.stores (id),
  provider              text NOT NULL CHECK (provider IN ('razorpay', 'stripe')),
  mode                  text NOT NULL CHECK (mode IN ('test', 'live')),
  public_key            text NOT NULL CHECK (char_length(public_key) BETWEEN 8 AND 200),
  secret_key_enc        text NOT NULL CHECK (secret_key_enc LIKE 'v1:%'),
  webhook_secret_enc    text NOT NULL CHECK (webhook_secret_enc LIKE 'v1:%'),
  -- Last four characters, to show which key is connected without revealing it.
  secret_key_hint       text NOT NULL CHECK (char_length(secret_key_hint) BETWEEN 1 AND 12),
  enabled               boolean NOT NULL DEFAULT true,
  connected_by          uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, provider)
);

CREATE TRIGGER payment_accounts_set_updated_at BEFORE UPDATE ON app.payment_accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Orders gain card payments, refunds and partial fulfilment ------------------------------

ALTER TABLE app.orders DROP CONSTRAINT orders_payment_method_check;
ALTER TABLE app.orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cod', 'bank', 'upi', 'whatsapp', 'telegram', 'card'));
ALTER TABLE app.orders DROP CONSTRAINT orders_payment_status_check;
ALTER TABLE app.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'partially_refunded', 'refunded'));
ALTER TABLE app.orders DROP CONSTRAINT orders_check1;
ALTER TABLE app.orders ADD CONSTRAINT orders_paid_at_check CHECK ((payment_status = 'pending') = (paid_at IS NULL));
ALTER TABLE app.orders DROP CONSTRAINT orders_fulfillment_status_check;
ALTER TABLE app.orders ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('unfulfilled', 'partially_fulfilled', 'fulfilled'));
ALTER TABLE app.orders ADD COLUMN refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0);
ALTER TABLE app.orders ADD CONSTRAINT orders_refund_within_total CHECK (refunded_minor <= total_minor);
-- Card orders that were never paid are cancelled automatically after a while.
ALTER TABLE app.orders ADD COLUMN payment_due_at timestamptz;
CREATE INDEX orders_unpaid_card_idx ON app.orders (payment_due_at) WHERE payment_method = 'card' AND payment_status = 'pending' AND status = 'open';

ALTER TABLE app.order_events DROP CONSTRAINT order_events_kind_check;
ALTER TABLE app.order_events ADD CONSTRAINT order_events_kind_check
  CHECK (kind IN ('placed', 'paid', 'fulfilled', 'cancelled', 'note', 'email_sent', 'payment_failed', 'refunded'));

GRANT UPDATE (refunded_minor, payment_due_at) ON app.orders TO wec_api;

-- payments: one row per gateway attempt (or a manual record) -------------------------------

CREATE TABLE app.payments (
  id                  uuid NOT NULL DEFAULT uuidv7(),
  store_id            uuid NOT NULL,
  order_id            uuid NOT NULL,
  provider            text NOT NULL CHECK (provider IN ('razorpay', 'stripe', 'manual')),
  -- Razorpay order id or Stripe Checkout Session id.
  provider_ref        text CHECK (char_length(provider_ref) <= 200),
  -- Razorpay payment id or Stripe PaymentIntent id, once paid.
  provider_payment_id text CHECK (char_length(provider_payment_id) <= 200),
  status              text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'succeeded', 'failed')),
  method              text CHECK (char_length(method) <= 50),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  mode                text NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id),
  CHECK ((status = 'succeeded') <= (provider = 'manual' OR provider_payment_id IS NOT NULL))
);

CREATE UNIQUE INDEX payments_provider_ref_idx ON app.payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payments_order_idx ON app.payments (order_id);
CREATE INDEX payments_store_created_idx ON app.payments (store_id, created_at DESC, id DESC);

CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- refunds ------------------------------------------------------------------------------

CREATE TABLE app.refunds (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  store_id           uuid NOT NULL,
  order_id           uuid NOT NULL,
  -- The card payment refunded through its gateway; null for a refund paid outside (cash, UPI, bank).
  payment_id         uuid,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason             text CHECK (char_length(reason) <= 500),
  provider_refund_id text CHECK (char_length(provider_refund_id) <= 200),
  status             text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  failure_code       text CHECK (failure_code ~ '^[a-z][a-z0-9_]*$'),
  restocked          boolean NOT NULL DEFAULT false,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id),
  FOREIGN KEY (store_id, payment_id) REFERENCES app.payments (store_id, id)
);

CREATE INDEX refunds_order_idx ON app.refunds (order_id);
CREATE INDEX refunds_store_created_idx ON app.refunds (store_id, created_at DESC, id DESC);

CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON app.refunds
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- fulfilments ------------------------------------------------------------------------------

CREATE TABLE app.fulfillments (
  id              uuid NOT NULL DEFAULT uuidv7(),
  store_id        uuid NOT NULL,
  order_id        uuid NOT NULL,
  carrier         text CHECK (char_length(carrier) <= 100),
  tracking_number text CHECK (char_length(tracking_number) <= 100),
  tracking_url    text CHECK (tracking_url ~ '^https://' AND char_length(tracking_url) <= 500),
  notify_customer boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id)
);

CREATE INDEX fulfillments_order_idx ON app.fulfillments (order_id);

CREATE TABLE app.fulfillment_items (
  store_id       uuid NOT NULL,
  fulfillment_id uuid NOT NULL,
  order_item_id  uuid NOT NULL,
  quantity       integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (fulfillment_id, order_item_id),
  FOREIGN KEY (store_id, fulfillment_id) REFERENCES app.fulfillments (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES app.order_items (id)
);

CREATE INDEX fulfillment_items_item_idx ON app.fulfillment_items (order_item_id);

-- Gateway webhook deliveries, so a retried delivery is processed once -----------------------

CREATE TABLE app.webhook_events (
  store_id    uuid NOT NULL,
  provider    text NOT NULL CHECK (provider IN ('razorpay', 'stripe')),
  event_id    text NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 200),
  event_type  text NOT NULL CHECK (char_length(event_type) <= 100),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, provider, event_id)
);

-- Checkouts: a shopper who reached checkout and gave an email --------------------------------
-- Turned into an order, or left behind (an abandoned checkout the merchant can follow up).

CREATE TABLE app.checkouts (
  id         uuid NOT NULL DEFAULT uuidv7(),
  store_id   uuid NOT NULL REFERENCES app.stores (id),
  email      text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  name       text CHECK (char_length(name) <= 200),
  phone      text CHECK (char_length(phone) <= 30),
  items      jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND octet_length(items::text) <= 16384),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  currency   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  order_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id)
);

CREATE INDEX checkouts_open_idx ON app.checkouts (store_id, updated_at DESC) WHERE order_id IS NULL;

CREATE TRIGGER checkouts_set_updated_at BEFORE UPDATE ON app.checkouts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Row security ------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_accounts', 'payments', 'refunds', 'fulfillments', 'fulfillment_items', 'webhook_events', 'checkouts'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END
$$;

-- Privileges -------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON app.payment_accounts TO wec_api;
GRANT SELECT, INSERT ON app.payments, app.refunds, app.fulfillments, app.fulfillment_items, app.webhook_events TO wec_api;
GRANT UPDATE (provider_payment_id, status, method, updated_at) ON app.payments TO wec_api;
GRANT UPDATE (provider_refund_id, status, failure_code, updated_at) ON app.refunds TO wec_api;
GRANT SELECT, INSERT, UPDATE ON app.checkouts TO wec_api;
-- The worker cancels unpaid card orders and puts their stock back.
GRANT SELECT ON app.order_items, app.payments, app.inventory_levels, app.inventory_movements TO wec_worker;
GRANT UPDATE (status, cancelled_at, updated_at) ON app.orders TO wec_worker;
GRANT UPDATE (stock_taken) ON app.order_items TO wec_worker;
GRANT UPDATE (on_hand, updated_at) ON app.inventory_levels TO wec_worker;
GRANT INSERT ON app.inventory_movements TO wec_worker;
GRANT UPDATE (status, updated_at) ON app.payments TO wec_worker;
-- The worker emails tracking details.
GRANT SELECT ON app.fulfillments, app.fulfillment_items TO wec_worker;
