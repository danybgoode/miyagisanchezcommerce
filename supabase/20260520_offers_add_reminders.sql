-- Track which reminder emails have been sent per offer
-- Prevents duplicate sends when the cron runs multiple times in the same window.
-- Keys: seller_24h, seller_expiry, buyer_counter_expiry, buyer_payment_expiry

ALTER TABLE marketplace_offers
  ADD COLUMN IF NOT EXISTS reminders_sent JSONB NOT NULL DEFAULT '{}';
