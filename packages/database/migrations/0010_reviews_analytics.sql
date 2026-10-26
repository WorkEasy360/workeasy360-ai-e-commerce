-- Reviews and analytics.

-- Reviews ---------------------------------------------------------------------------------------
-- Only buyers review: a review belongs to an order line, reached through the
-- shopper's order link or an emailed review link. One review per product per
-- order. Merchants publish, hide and reply.

CREATE TABLE app.reviews (
  id          uuid NOT NULL DEFAULT uuidv7(),
  store_id    uuid NOT NULL REFERENCES app.stores (id),
  product_id  uuid NOT NULL,
  order_id    uuid NOT NULL,
  customer_id uuid NOT NULL,
  -- Shown publicly: first name and initial ("Asha R.").
  author_name text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 60),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       text CHECK (char_length(title) <= 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  reply       text CHECK (char_length(reply) <= 2000),
  replied_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (order_id, product_id),
  FOREIGN KEY (store_id, product_id) REFERENCES app.products (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, customer_id) REFERENCES app.customers (store_id, id),
  CHECK ((reply IS NULL) = (replied_at IS NULL))
);

CREATE INDEX reviews_product_idx ON app.reviews (product_id, status, created_at DESC);
CREATE INDEX reviews_store_idx ON app.reviews (store_id, status, created_at DESC);

CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON app.reviews
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.review_settings (
  store_id     uuid PRIMARY KEY REFERENCES app.stores (id),
  -- Publish 4 and 5 star reviews without waiting; lower ratings wait for the merchant.
  auto_publish boolean NOT NULL DEFAULT false,
  -- Email buyers a review link this many days after their order is fulfilled; null: don't.
  request_after_days smallint DEFAULT 5 CHECK (request_after_days BETWEEN 1 AND 60),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The emailed review link: a random token (only its hash is kept) for one order.
CREATE TABLE app.review_requests (
  store_id   uuid NOT NULL,
  order_id   uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id),
  FOREIGN KEY (store_id, order_id) REFERENCES app.orders (store_id, id) ON DELETE CASCADE
);

-- Analytics -----------------------------------------------------------------------------------
-- Storefront events carry no personal data: a random per-browser session id,
-- the page, the product, where the visit came from and the device class. No
-- IP address or user agent is stored. Raw events are kept 90 days; the daily
-- rollups keep the history.

CREATE TABLE app.analytics_events (
  id            uuid NOT NULL DEFAULT uuidv7(),
  store_id      uuid NOT NULL REFERENCES app.stores (id),
  session_id    text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  type          text NOT NULL CHECK (type IN ('page_view', 'product_view', 'add_to_cart', 'checkout_start')),
  path          text CHECK (char_length(path) <= 300),
  product_id    uuid,
  source        text NOT NULL DEFAULT 'direct' CHECK (char_length(source) BETWEEN 1 AND 60),
  device        text NOT NULL DEFAULT 'desktop' CHECK (device IN ('mobile', 'tablet', 'desktop')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX analytics_events_store_time_idx ON app.analytics_events (store_id, created_at);
CREATE INDEX analytics_events_time_idx ON app.analytics_events (created_at);

CREATE TABLE app.analytics_daily (
  store_id       uuid NOT NULL REFERENCES app.stores (id),
  day            date NOT NULL,
  visitors       integer NOT NULL DEFAULT 0,
  page_views     integer NOT NULL DEFAULT 0,
  product_views  integer NOT NULL DEFAULT 0,
  -- Sessions that did each step, for the funnel.
  viewed_product integer NOT NULL DEFAULT 0,
  added_to_cart  integer NOT NULL DEFAULT 0,
  reached_checkout integer NOT NULL DEFAULT 0,
  orders         integer NOT NULL DEFAULT 0,
  revenue_minor  bigint NOT NULL DEFAULT 0,
  mobile_visitors integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, day)
);

CREATE TABLE app.analytics_sources_daily (
  store_id uuid NOT NULL REFERENCES app.stores (id),
  day      date NOT NULL,
  source   text NOT NULL,
  visitors integer NOT NULL,
  PRIMARY KEY (store_id, day, source)
);

CREATE TABLE app.analytics_products_daily (
  store_id     uuid NOT NULL REFERENCES app.stores (id),
  day          date NOT NULL,
  product_id   uuid NOT NULL,
  views        integer NOT NULL DEFAULT 0,
  added_to_cart integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, day, product_id)
);

-- Row security and grants -----------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reviews', 'review_settings', 'review_requests', 'analytics_events', 'analytics_daily', 'analytics_sources_daily', 'analytics_products_daily'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY store_isolation ON app.%I USING (store_id = app.current_store_id()) WITH CHECK (store_id = app.current_store_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.reviews TO wec_api;
GRANT SELECT, INSERT, UPDATE ON app.review_settings TO wec_api;
GRANT SELECT ON app.review_requests TO wec_api;
GRANT INSERT ON app.analytics_events TO wec_api;
GRANT SELECT ON app.analytics_events, app.analytics_daily, app.analytics_sources_daily, app.analytics_products_daily TO wec_api;
GRANT INSERT, UPDATE, DELETE ON app.analytics_daily, app.analytics_sources_daily, app.analytics_products_daily TO wec_api;

GRANT SELECT ON app.review_settings TO wec_worker;
GRANT SELECT, INSERT ON app.review_requests TO wec_worker;
GRANT SELECT ON app.reviews, app.analytics_events TO wec_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.analytics_daily, app.analytics_sources_daily, app.analytics_products_daily TO wec_worker;

-- The worker rolls up and expires analytics across stores. These two
-- functions are its only view across store boundaries: which stores had
-- activity, and deleting events past their retention.

CREATE POLICY analytics_activity_lookup ON app.analytics_events FOR SELECT TO wec_owner USING (true);
CREATE POLICY analytics_retention ON app.analytics_events FOR DELETE TO wec_owner USING (true);
CREATE POLICY orders_activity_lookup ON app.orders FOR SELECT TO wec_owner USING (true);

CREATE FUNCTION app.analytics_active_stores(p_since timestamptz)
  RETURNS TABLE (store_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT DISTINCT e.store_id FROM app.analytics_events e WHERE e.created_at >= p_since
    UNION
    SELECT DISTINCT o.store_id FROM app.orders o WHERE o.updated_at >= p_since
  $$;

CREATE FUNCTION app.purge_analytics_events(p_before timestamptz, p_limit integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    WITH doomed AS (
      SELECT id FROM app.analytics_events WHERE created_at < p_before ORDER BY created_at LIMIT least(greatest(p_limit, 1), 50000)
    ), gone AS (
      DELETE FROM app.analytics_events e USING doomed WHERE e.id = doomed.id RETURNING 1
    )
    SELECT count(*)::int FROM gone
  $$;

REVOKE ALL ON FUNCTION app.analytics_active_stores(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purge_analytics_events(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.analytics_active_stores(timestamptz), app.purge_analytics_events(timestamptz, integer) TO wec_worker;

