-- Store raw scraper output per admin run so acquisition can export CSV
-- without automatically publishing listings to the marketplace.

CREATE TABLE IF NOT EXISTS marketplace_scrape_run_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES marketplace_scrape_runs(id) ON DELETE CASCADE,

  source_platform       TEXT NOT NULL,
  source_url            TEXT,
  source_id             TEXT,

  shop_name             TEXT,
  shop_source_url       TEXT,
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
  image_url             TEXT,
  raw_data              JSONB NOT NULL DEFAULT '{}'::jsonb,

  status                TEXT NOT NULL DEFAULT 'collected',
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_scrape_run_items_run_id_idx
  ON marketplace_scrape_run_items (run_id);

CREATE INDEX IF NOT EXISTS marketplace_scrape_run_items_source_url_idx
  ON marketplace_scrape_run_items (source_url)
  WHERE source_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_scrape_run_items_run_source_url_idx
  ON marketplace_scrape_run_items (run_id, source_url)
  WHERE source_url IS NOT NULL;
