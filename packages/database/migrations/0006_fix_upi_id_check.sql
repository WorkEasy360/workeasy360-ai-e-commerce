-- 0005's UPI ID check used a repeat count of 256, above PostgreSQL's limit of
-- 255, so saving any UPI ID failed with "invalid regular expression". UPI
-- handles are short; allow up to 64 characters before the @.
ALTER TABLE app.checkout_settings DROP CONSTRAINT checkout_settings_upi_id_check;
ALTER TABLE app.checkout_settings ADD CONSTRAINT checkout_settings_upi_id_check
  CHECK (upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$');
