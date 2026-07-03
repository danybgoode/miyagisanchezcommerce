-- ml-orders-native · Sprint 1 — seed the ML order-materialization enablement flag
-- into the in-house flag store (epic 09 · feature-flags-inhouse). Behavior-
-- preserving: seeds OFF (= DEFAULT_FLAGS), so this is a no-op until an admin
-- deliberately flips it in /admin/flags after the live ML-sandbox smoke passes.
--
-- `ml.orders_enabled` is DISTINCT from `ml.sync_enabled`:
--   ml.sync_enabled    → the kill-switch that halts the two-way stock sync (S4).
--   ml.orders_enabled  → whether a paid ML sale ALSO materializes as a real
--                        Medusa order (ml-orders-native S1). OFF ⇒ stock sync
--                        keeps working exactly as before; no order is created.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('ml.orders_enabled', false, 'enablement', 'Materialize a paid ML sale as a real Medusa order (ml-orders-native S1). OFF ⇒ stock sync only, no order.')
ON CONFLICT (key) DO NOTHING;
