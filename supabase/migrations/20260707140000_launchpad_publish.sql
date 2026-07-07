-- Bookshop launchpad · Sprint 1 (Story 1.3) — publish an approved submission as
-- a digital product. `published_product_id` (already on the table) links the
-- submission to the minted Medusa product; this adds a notify-once timestamp so
-- the writer's "ya está publicado" email fires exactly once, when the seller
-- first ACTIVATES the listing (not at draft-mint time, when the URL 404s).
ALTER TABLE launchpad_submissions
  ADD COLUMN IF NOT EXISTS published_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS launchpad_submissions_published_product_idx
  ON launchpad_submissions (published_product_id)
  WHERE published_product_id IS NOT NULL;
