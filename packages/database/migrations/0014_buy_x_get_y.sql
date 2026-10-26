-- Buy X get Y offers: buy `buy_quantity` of the offer's products (applies_to /
-- target_ids), get `get_quantity` more free or at `value` basis points off.
-- What the shopper gets is the same products, or other collections or
-- products. `max_applications` caps how many times one order can use it.

ALTER TABLE app.discounts DROP CONSTRAINT discounts_type_check;
ALTER TABLE app.discounts ADD CONSTRAINT discounts_type_check CHECK (type IN ('percentage', 'fixed', 'free_shipping', 'buy_x_get_y'));

ALTER TABLE app.discounts
  ADD COLUMN buy_quantity     integer CHECK (buy_quantity BETWEEN 1 AND 100),
  ADD COLUMN get_quantity     integer CHECK (get_quantity BETWEEN 1 AND 100),
  ADD COLUMN get_applies_to   text CHECK (get_applies_to IN ('same', 'collections', 'products')),
  ADD COLUMN get_target_ids   uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(get_target_ids) <= 100),
  ADD COLUMN max_applications integer CHECK (max_applications BETWEEN 1 AND 100);

ALTER TABLE app.discounts ADD CONSTRAINT discounts_buy_x_get_y_check CHECK (
  CASE WHEN type = 'buy_x_get_y'
    THEN buy_quantity IS NOT NULL AND get_quantity IS NOT NULL AND get_applies_to IS NOT NULL
      AND value BETWEEN 1 AND 10000
      AND (get_applies_to = 'same') = (cardinality(get_target_ids) = 0)
    ELSE buy_quantity IS NULL AND get_quantity IS NULL AND get_applies_to IS NULL
      AND cardinality(get_target_ids) = 0 AND max_applications IS NULL
  END
);
