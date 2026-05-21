-- UCP Phase C: Identity, Negotiation Rules, Order Webhooks
-- ─────────────────────────────────────────────────────────────────────────────

-- #14 — min_buyer_trust_level: seller can require buyers to meet a trust threshold
-- Stored in metadata JSONB (no column needed, already deep-merged on PATCH)

-- #15 — negotiation_rules: per-shop auto-accept/counter/decline thresholds
-- Also stored in metadata JSONB

-- #16 — UCP order webhooks: proper columns for security (secret must not live in JSONB)
ALTER TABLE marketplace_shops
  ADD COLUMN IF NOT EXISTS ucp_webhook_url    TEXT,
  ADD COLUMN IF NOT EXISTS ucp_webhook_secret TEXT;  -- HMAC-SHA256 signing secret
