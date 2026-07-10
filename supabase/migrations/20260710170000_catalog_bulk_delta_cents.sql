-- ── Confirm-dialog totals for staged suggested-price batches ─────────────────
-- catalog-management epic, Sprint 4 · Story 4.2. Nullable, additive column —
-- NULL for every one of the 7 pre-existing action types (price_set, price_pct,
-- pause_activate, publish_channel, category, collection_assign,
-- inventory_mode, delete); populated only when the staged action is
-- 'apply_suggested_price', letting BulkDiffPreview sum a real dollar total
-- for the confirm dialog without parsing the display-string `after` field.

ALTER TABLE catalog_bulk_batch_items ADD COLUMN delta_cents INTEGER;
