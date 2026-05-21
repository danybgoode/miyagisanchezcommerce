-- Run in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

CREATE TABLE IF NOT EXISTS marketplace_offers (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                UUID        NOT NULL REFERENCES marketplace_listings(id),
  shop_id                   UUID        NOT NULL REFERENCES marketplace_shops(id),

  -- Buyer identity (Clerk optional — anonymous buyers give name + email)
  buyer_clerk_user_id       TEXT,
  buyer_email               TEXT        NOT NULL,
  buyer_name                TEXT        NOT NULL,

  -- The offer
  offer_amount_cents        INTEGER     NOT NULL CHECK (offer_amount_cents > 0),
  message                   TEXT        CHECK (char_length(message) <= 500),

  -- status: pending | accepted | declined | countered | expired | withdrawn | paid
  status                    TEXT        NOT NULL DEFAULT 'pending',

  -- Seller counter (optional)
  counter_amount_cents      INTEGER,
  counter_message           TEXT        CHECK (char_length(counter_message) <= 500),
  counter_expires_at        TIMESTAMPTZ,

  -- Stripe checkout generated on accept/counter-accept
  checkout_session_id       TEXT,
  checkout_expires_at       TIMESTAMPTZ,

  -- Offer auto-expires if seller doesn't respond
  expires_at                TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active (pending/countered) offer per buyer email per listing
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_offers_active_unique
  ON marketplace_offers (listing_id, lower(buyer_email))
  WHERE status IN ('pending', 'countered');

CREATE INDEX IF NOT EXISTS marketplace_offers_listing_id_idx  ON marketplace_offers (listing_id);
CREATE INDEX IF NOT EXISTS marketplace_offers_shop_id_idx     ON marketplace_offers (shop_id);
CREATE INDEX IF NOT EXISTS marketplace_offers_buyer_email_idx ON marketplace_offers (buyer_email);
CREATE INDEX IF NOT EXISTS marketplace_offers_status_idx      ON marketplace_offers (status);
CREATE INDEX IF NOT EXISTS marketplace_offers_buyer_clerk_idx ON marketplace_offers (buyer_clerk_user_id)
  WHERE buyer_clerk_user_id IS NOT NULL;

-- Reuse the update_updated_at() function created by orders migration
DROP TRIGGER IF EXISTS marketplace_offers_updated_at ON marketplace_offers;
CREATE TRIGGER marketplace_offers_updated_at
  BEFORE UPDATE ON marketplace_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
