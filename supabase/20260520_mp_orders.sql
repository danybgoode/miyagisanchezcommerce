-- MercadoPago payment columns on marketplace_orders.
-- mp_payment_id has a partial unique index to enforce idempotency.

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_id    TEXT,
  ADD COLUMN IF NOT EXISTS mp_status        TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_orders_mp_payment_id_idx
  ON marketplace_orders (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
