-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                  UUID        NOT NULL REFERENCES marketplace_listings(id),
  shop_id                     UUID        NOT NULL REFERENCES marketplace_shops(id),
  stripe_session_id           TEXT        UNIQUE,
  stripe_payment_intent_id    TEXT,
  buyer_email                 TEXT,
  buyer_name                  TEXT,
  amount_cents                INTEGER     NOT NULL,
  currency                    TEXT        NOT NULL DEFAULT 'MXN',
  -- pending → paid → fulfilled (digital) or delivered (physical) → refunded
  status                      TEXT        NOT NULL DEFAULT 'pending',
  digital_download_url        TEXT,
  digital_download_expires_at TIMESTAMPTZ,
  metadata                    JSONB       NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_orders_listing_id_idx  ON marketplace_orders (listing_id);
CREATE INDEX IF NOT EXISTS marketplace_orders_shop_id_idx     ON marketplace_orders (shop_id);
CREATE INDEX IF NOT EXISTS marketplace_orders_buyer_email_idx ON marketplace_orders (buyer_email);
CREATE INDEX IF NOT EXISTS marketplace_orders_status_idx      ON marketplace_orders (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS marketplace_orders_updated_at ON marketplace_orders;
CREATE TRIGGER marketplace_orders_updated_at
  BEFORE UPDATE ON marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
