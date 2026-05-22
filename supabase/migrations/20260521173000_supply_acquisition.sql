-- Supply acquisition staging workflow.
-- Keeps bulk scraped/CSV data out of live marketplace tables until reviewed.

CREATE TABLE IF NOT EXISTS supply_batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  source_platform       TEXT NOT NULL,
  source_mode           TEXT NOT NULL,
  category              TEXT,
  listing_type          TEXT NOT NULL DEFAULT 'product',
  state                 TEXT,
  municipio             TEXT,
  location              TEXT,
  target_status         TEXT NOT NULL DEFAULT 'active',
  acquisition_settings  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL DEFAULT 'collecting',
  total_count           INTEGER NOT NULL DEFAULT 0,
  approved_count        INTEGER NOT NULL DEFAULT 0,
  rejected_count        INTEGER NOT NULL DEFAULT 0,
  imported_count        INTEGER NOT NULL DEFAULT 0,
  duplicate_count       INTEGER NOT NULL DEFAULT 0,
  failed_count          INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS supply_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES supply_batches(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending_review',
  quality_score         INTEGER NOT NULL DEFAULT 0,
  duplicate_key         TEXT,

  source_platform       TEXT NOT NULL,
  source_url            TEXT,
  source_id             TEXT,

  shop_name             TEXT,
  shop_slug             TEXT,
  shop_source_url       TEXT,
  shop_description      TEXT,
  shop_location         TEXT,
  shop_logo_url         TEXT,
  shop_metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,

  listing_title         TEXT,
  listing_description   TEXT,
  price_cents           INTEGER,
  currency              TEXT NOT NULL DEFAULT 'MXN',
  condition             TEXT,
  listing_type          TEXT NOT NULL DEFAULT 'product',
  category              TEXT,
  state                 TEXT,
  municipio             TEXT,
  location              TEXT,
  images                JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  listing_metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,

  raw_data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  imported_shop_id      UUID,
  imported_listing_id   UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS supply_batches_created_at_idx
  ON supply_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS supply_items_batch_status_idx
  ON supply_items (batch_id, status);

CREATE INDEX IF NOT EXISTS supply_items_source_url_idx
  ON supply_items (source_url)
  WHERE source_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supply_items_batch_duplicate_key_idx
  ON supply_items (batch_id, duplicate_key)
  WHERE duplicate_key IS NOT NULL;

CREATE OR REPLACE FUNCTION touch_supply_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supply_batches_touch_updated_at ON supply_batches;
CREATE TRIGGER supply_batches_touch_updated_at
  BEFORE UPDATE ON supply_batches
  FOR EACH ROW EXECUTE FUNCTION touch_supply_updated_at();

DROP TRIGGER IF EXISTS supply_items_touch_updated_at ON supply_items;
CREATE TRIGGER supply_items_touch_updated_at
  BEFORE UPDATE ON supply_items
  FOR EACH ROW EXECUTE FUNCTION touch_supply_updated_at();
