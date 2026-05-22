-- Sprint 3: Subscriptions Phase B
-- Adds tier tracking and MercadoPago preapproval fields to subscriptions.

ALTER TABLE marketplace_subscriptions
  ADD COLUMN IF NOT EXISTS tier_id            TEXT,
  ADD COLUMN IF NOT EXISTS mp_preapproval_id   TEXT,
  ADD COLUMN IF NOT EXISTS mp_preapproval_plan_id TEXT;

-- Unique index on MP preapproval ID for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_subscriptions_mp_preapproval_id_idx
  ON marketplace_subscriptions (mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;
