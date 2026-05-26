-- ── Return requests ────────────────────────────────────────────────────────────
-- Buyers can open a return/refund request after delivery.
-- Sellers can accept (triggering Stripe refund), decline, or offer a partial refund.

CREATE TABLE IF NOT EXISTS marketplace_return_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID        NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  shop_id              UUID        NOT NULL REFERENCES marketplace_shops(id)  ON DELETE CASCADE,
  buyer_clerk_user_id  TEXT,
  buyer_email          TEXT,

  -- Buyer's reason
  reason               TEXT        NOT NULL CHECK (reason IN (
    'not_as_described',
    'damaged',
    'wrong_item',
    'changed_mind',
    'other'
  )),
  description          TEXT,

  -- Resolution
  status               TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'accepted',
    'partial_refund',
    'declined',
    'refunded'   -- Stripe refund issued
  )),
  refund_amount_cents  INTEGER,
  seller_note          TEXT,
  stripe_refund_id     TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mrr_order_id   ON marketplace_return_requests(order_id);
CREATE INDEX IF NOT EXISTS mrr_shop_id    ON marketplace_return_requests(shop_id);
CREATE INDEX IF NOT EXISTS mrr_buyer_email ON marketplace_return_requests(buyer_email);

-- Track when a return was opened on the order itself (for quick UI checks)
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ;

-- Reuse the update_updated_at() trigger if it already exists
CREATE TRIGGER set_updated_at_return_requests
  BEFORE UPDATE ON marketplace_return_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
