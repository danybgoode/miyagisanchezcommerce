-- Mercado Libre sync · Sprint 5 (epic 03 · mercadolibre-sync) — seed the ML-sync
-- paid/promoter-SKU entitlement flag into the in-house flag store (epic 09 ·
-- feature-flags-inhouse). Behavior-preserving: seeds OFF (= DEFAULT_FLAGS), so this
-- is a no-op until an admin deliberately flips it in /admin/flags to start charging.
--
-- `ml.sync_paywall_enabled` is DISTINCT from `ml.sync_enabled`:
--   ml.sync_enabled          → the kill-switch that halts the sync ENGINE (backend).
--   ml.sync_paywall_enabled  → whether the seller "enable sync" toggle is PAYWALLED.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('ml.sync_paywall_enabled', false, 'enablement', 'ML-sync paid/promoter-SKU entitlement gate (epic 03 S5). OFF ⇒ no paywall.')
ON CONFLICT (key) DO NOTHING;
