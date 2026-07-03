-- Promoter Funnel v2 · Sprint 4 (US-4.1/US-4.2) — additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.
--
-- The net-remittance (SPEI/DiMo/CoDi) close: a promoter who collected cash reports a
-- transfer of (price − commission) instead of paying by card; Daniel approves after
-- checking his bank app, which activates the SKU (existing grant writers — no new
-- money path) and notifies the promoter. Remittance state is a concept Medusa has no
-- notion of → Supabase (AGENTS rule #2). Mirrors the print cash-report pattern
-- (payment_reported flag + admin confirm), generalized into its own state machine
-- since domain/subdomain/ml_sync have no cart/order to attach a content-JSON flag to.

-- One row per transfer attempt. Only one PENDING/REPORTED row may exist per
-- (seller_id, sku) at a time (see the partial unique index below) — a rejected or
-- approved transfer never blocks a fresh attempt.
CREATE TABLE IF NOT EXISTS marketplace_promoter_transfers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID        NOT NULL,
  seller_id           TEXT        NOT NULL,   -- the target shop (marketplace_shops.id)
  sku                 TEXT        NOT NULL CHECK (sku IN ('custom_domain', 'subdomain', 'ml_sync')),
  method              TEXT        NOT NULL CHECK (method IN ('spei', 'dimo', 'codi')),
  -- Frozen at creation — never recomputed later, so a later rate/price edit can't
  -- retroactively change what a promoter was shown or what gets activated.
  gross_amount_cents      INTEGER NOT NULL CHECK (gross_amount_cents >= 0),
  commission_cents         INTEGER NOT NULL CHECK (commission_cents >= 0),
  owed_cents               INTEGER NOT NULL CHECK (owed_cents >= 0),
  transfer_details    JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- CLABE/bank/DiMo/CoDi snapshot shown to the promoter
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reported', 'approved', 'rejected')),
  reported_at         TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  approved_by         TEXT,       -- clerk_user_id of the admin who approved
  rejected_at         TIMESTAMPTZ,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_promoter_transfers_promoter_idx
  ON marketplace_promoter_transfers (promoter_id);
CREATE INDEX IF NOT EXISTS marketplace_promoter_transfers_status_idx
  ON marketplace_promoter_transfers (status);

-- Only one active (pending/reported) transfer per shop+SKU at a time.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoter_transfers_active_uniq
  ON marketplace_promoter_transfers (seller_id, sku)
  WHERE status IN ('pending', 'reported');

-- Admin-editable transfer instructions (CLABE / bank name / DiMo phone / CoDi
-- reference) shown to the promoter at close — never hardcoded. Additive JSONB
-- column, defaulting to '{}' so existing behavior (no transfer option surfaced
-- until both this is configured AND the flag is on) is unchanged.
ALTER TABLE marketplace_promoter_settings
  ADD COLUMN IF NOT EXISTS transfer_details JSONB NOT NULL DEFAULT '{}'::jsonb;
