-- Promoter Program · Sprint 1 — additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.
--
-- Mirrors the referral spine (20260603100000_referrals.sql) in a distinct promoter
-- namespace so promoter codes never collide with buyer referral codes. Promoter
-- attribution/commission are concepts Medusa has no notion of → Supabase (AGENTS rule #2).
-- Promoters are admin-provisioned in v1 (rows, not Clerk users), so the code is identity.

-- One promoter = one shareable code (PRM-XXXXXX).
CREATE TABLE IF NOT EXISTS marketplace_promoters (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger: one row per enrollment / attributed sale.
-- status: 'enrolled' (code applied, no charge yet — Sprint 1) → 'sold' (paid, Sprint 2)
-- gross_amount_cents + cadence fill in when the real charge lands (Sprint 2).
CREATE TABLE IF NOT EXISTS marketplace_promoter_attributions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id        UUID        NOT NULL,
  seller_id          TEXT,
  sku                TEXT,
  gross_amount_cents INTEGER,
  cadence            TEXT,
  status             TEXT        NOT NULL DEFAULT 'enrolled',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_promoter_attributions_promoter_idx
  ON marketplace_promoter_attributions (promoter_id);
CREATE INDEX IF NOT EXISTS marketplace_promoter_attributions_status_idx
  ON marketplace_promoter_attributions (status);

-- Idempotency: one enrollment row per (promoter, seller, SKU) so re-running
-- checkout doesn't double-write. Partial so unidentified (NULL) rows never block.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoter_attributions_uniq
  ON marketplace_promoter_attributions (promoter_id, seller_id, sku)
  WHERE seller_id IS NOT NULL AND sku IS NOT NULL;

-- Singleton, admin-editable discount config (no deploy needed to change the amount).
-- `enabled` is the admin toggle for the seller discount; the feature kill-switch is
-- the Flagsmith flag `promoter.enabled` (lib/flags.ts) — two distinct gates.
CREATE TABLE IF NOT EXISTS marketplace_promoter_settings (
  id                    INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  discount_type         TEXT        NOT NULL DEFAULT 'fixed',     -- 'fixed' | 'percentage'
  discount_amount_cents INTEGER     NOT NULL DEFAULT 10000,       -- $100 MXN off the SKU (or raw % when 'percentage')
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO marketplace_promoter_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
