-- arranged-only-delivery · Sprint 1 — seed the arranged-only delivery enablement
-- flag into the in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: seeds OFF (= DEFAULT_FLAGS in both apps' lib/flags.ts), so
-- this is a no-op until an admin deliberately flips it in /admin/flags after
-- Sprint 1 lands and Daniel's live money-path smoke (placing a real arranged
-- order via pago directo) passes.
--
-- shipping.arranged_only_enabled gates the per-listing delivery_mode: 'arranged'
-- branch in checkout-options (pushes a coord delivery method, suppresses carrier
-- shipping, sets only_coordinated) and the seller-facing "Entrega" toggle. OFF ⇒
-- every listing behaves as carrier (today's behavior), byte-identical.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('shipping.arranged_only_enabled', false, 'enablement', 'Per-listing arranged-only delivery (arranged-only-delivery S1). OFF ⇒ every listing behaves as carrier (today''s behavior).')
ON CONFLICT (key) DO NOTHING;
