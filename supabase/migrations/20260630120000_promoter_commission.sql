-- Promoter Program · Sprint 3 — commission ledger. Additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.
--
-- Builds on the S1/S2 spine (20260629120000_promoter.sql): a paid+attributed sale
-- (marketplace_promoter_attributions.status = 'paid', with gross_amount_cents) now
-- accrues a commission for the promoter. Commission is a concept Medusa has no
-- notion of → Supabase (AGENTS rule #2). Settlement is OFFLINE in v1 — the admin
-- marks a commission paid after settling in cash/transfer; no in-app money moves.

-- Self-referral substrate: link a promoter to the Clerk account they may own a shop
-- under, so accrual can refuse when the promoter is the owner of the enrolled shop.
ALTER TABLE marketplace_promoters
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Per-SKU commission rate (admin-editable, no deploy). Keyed by SKU (vs the
-- singleton discount-settings row) so each paid SKU carries its own percentage.
CREATE TABLE IF NOT EXISTS marketplace_promoter_commission_rates (
  sku        TEXT        PRIMARY KEY,           -- 'custom_domain' | 'print_ad' (PROMOTER_SKUS)
  rate_pct   INTEGER     NOT NULL DEFAULT 0,    -- 0–100, whole percent of the gross
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a 0% row per known SKU so the admin edits an existing row (no surprise inserts).
INSERT INTO marketplace_promoter_commission_rates (sku, rate_pct) VALUES
  ('custom_domain', 0),
  ('print_ad', 0)
ON CONFLICT (sku) DO NOTHING;

-- The commission ledger: one row per accrued commission, snapshotting the rate +
-- gross at accrual time so a later rate edit never rewrites history.
-- status: 'accrued' (earned, unpaid) → 'paid' (settled offline, stamped paid_at + ref).
CREATE TABLE IF NOT EXISTS marketplace_promoter_commissions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id       UUID        NOT NULL UNIQUE,   -- one commission per paid attribution (exactly-once)
  promoter_id          UUID        NOT NULL,
  seller_id            TEXT,
  sku                  TEXT,
  rate_pct             INTEGER     NOT NULL,          -- snapshot of the rate at accrual
  gross_amount_cents   INTEGER     NOT NULL,          -- snapshot of the eligible gross
  commission_cents     INTEGER     NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'accrued',
  accrued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at              TIMESTAMPTZ,
  settlement_reference TEXT
);

CREATE INDEX IF NOT EXISTS marketplace_promoter_commissions_promoter_status_idx
  ON marketplace_promoter_commissions (promoter_id, status);
