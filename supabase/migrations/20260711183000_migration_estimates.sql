-- Platform migrations · Sprint 2 (Story 2.2) — the quoted-estimate record.
-- Additive, scoped to miyagisanchez (shared Supabase, service-role only).
--
-- Above the `migration` SKU's flat 150-listing cap, the platform computes AND
-- PERSISTS a quote (lib/migration-estimate.ts's pure breakdown); the promoter
-- close route (app/api/promoter/close/migration) prices the sale from THIS
-- stored row — a close referencing a quote can never charge a different
-- amount (the API is the guarantee, the UI is courtesy). Not a Medusa concept
-- (no product/order exists yet at quoting time) → Supabase (AGENTS rule 2).
-- References `supply_batches` (the Shopify connector's staged catalog, Sprint 1)
-- since there's no separate `parity_reports` table — the parity report is
-- computed on demand from the batch, never persisted on its own.

CREATE TABLE marketplace_migration_estimates (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id            UUID        NOT NULL REFERENCES supply_batches(id) ON DELETE CASCADE,
  shop_id             UUID        NOT NULL,                        -- marketplace_shops.id (the mirror UUID) — same key promoter close routes already use
  listing_count       INTEGER     NOT NULL CHECK (listing_count >= 0),
  image_count         INTEGER     NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  source_platform     TEXT,
  custom_sections     JSONB       NOT NULL DEFAULT '[]'::jsonb,    -- flagged ParitySectionKey[] (non-mapped sections)
  base_price_cents    INTEGER     NOT NULL CHECK (base_price_cents >= 0),
  overage_cents       INTEGER     NOT NULL DEFAULT 0 CHECK (overage_cents >= 0),
  section_adder_cents INTEGER     NOT NULL DEFAULT 0 CHECK (section_adder_cents >= 0),
  total_price_cents   INTEGER     NOT NULL CHECK (total_price_cents >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketplace_migration_estimates_batch ON marketplace_migration_estimates(batch_id, created_at DESC);
CREATE INDEX idx_marketplace_migration_estimates_shop ON marketplace_migration_estimates(shop_id);

-- RLS: ON, no policies — same pattern as catalog_bulk_batches/platform_flags
-- (the current precedent). Only the service-role client reads/writes; a close
-- route's ownership check (shop_id match) is the application-layer guard.
ALTER TABLE marketplace_migration_estimates ENABLE ROW LEVEL SECURITY;
