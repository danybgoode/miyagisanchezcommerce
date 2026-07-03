-- Promoter Funnel v2 · Sprint 3 (US-3.1) — additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.
--
-- Extends the promoter offer beyond the single global discount
-- (marketplace_promoter_settings.discount_type/discount_amount_cents) with:
--   1. an explicit PER-SKU promoter price (overrides the global discount formula
--      for that SKU when set — e.g. subdomain = $0 for the free first year, US-3.2);
--   2. a bundle definition (which SKUs + one bundle price), so the landing/handbook/
--      close workspace can show "todo esto cuesta $X — con tu promotor $Y".
-- Both are nullable / empty by default so existing behavior (the flat global
-- discount) is UNCHANGED until an admin explicitly sets a per-SKU price or bundle.

-- One row per SKU with an explicit promoter price. Absence of a row (or a NULL
-- promoter_price_mxn) means "no override — fall back to the global discount
-- formula" (lib/promoter-pricing.ts resolveSkuPromoterPriceCents).
CREATE TABLE IF NOT EXISTS marketplace_promoter_sku_prices (
  sku                 TEXT        PRIMARY KEY,
  promoter_price_mxn  INTEGER,    -- whole pesos; 0 = free (US-3.2); NULL = not configured
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bundle config lives on the settings singleton (one bundle at a time, v1).
ALTER TABLE marketplace_promoter_settings
  ADD COLUMN IF NOT EXISTS bundle_skus       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bundle_price_mxn  INTEGER;          -- NULL = bundle not configured
