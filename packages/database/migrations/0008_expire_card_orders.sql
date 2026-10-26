-- Expiring unpaid card orders ------------------------------------------------------
-- A card order holds its stock while the shopper pays. If payment doesn't
-- arrive by payment_due_at, the worker cancels the order and puts the stock
-- back. The worker has no store context while it looks for such orders, so
-- this lookup returns only which store and order are overdue; cancelling
-- then happens in that store's context like any other order change.

CREATE POLICY overdue_card_lookup ON app.orders FOR SELECT TO wec_owner
  USING (payment_method = 'card' AND payment_status = 'pending' AND status = 'open' AND payment_due_at IS NOT NULL);

CREATE FUNCTION app.overdue_card_orders(p_limit integer)
  RETURNS TABLE (store_id uuid, order_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT o.store_id, o.id FROM app.orders o
     WHERE o.payment_method = 'card' AND o.payment_status = 'pending' AND o.status = 'open'
       AND o.payment_due_at < now()
     ORDER BY o.payment_due_at
     LIMIT least(greatest(p_limit, 1), 500)
  $$;

REVOKE ALL ON FUNCTION app.overdue_card_orders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.overdue_card_orders(integer) TO wec_worker;

-- Cancelling clears the payment deadline.
GRANT UPDATE (payment_due_at) ON app.orders TO wec_worker;
