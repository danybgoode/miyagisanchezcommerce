-- Store Resend scheduled email IDs so they can be cancelled when offer state changes.
-- Keys: seller_24h, seller_expiry, buyer_counter_expiry, buyer_payment_expiry
-- Values: Resend email ID (e.g. "em_abc123")

ALTER TABLE marketplace_offers
  ADD COLUMN IF NOT EXISTS scheduled_reminder_ids JSONB NOT NULL DEFAULT '{}';
