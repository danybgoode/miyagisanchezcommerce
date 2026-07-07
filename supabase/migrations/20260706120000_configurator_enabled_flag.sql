-- custom-print-products · Sprint 3 — seed the configurator kill-switch into the
-- in-house flag store (epic 09 · feature-flags-inhouse). Behavior-preserving:
-- seeds ON (= DEFAULT_FLAGS, matching the `pdp_redesign` kill-switch polarity),
-- so this is a no-op until an admin deliberately flips it OFF in /admin/flags.
--
-- `configurator.enabled` gates ONLY the Sprint 3 addition — custom fields
-- (chiefly the artwork upload) inside the print-configurator buy box.
-- Sprint 2's underlying variant/tier selection + tier-correct checkout is
-- NOT gated by this flag and stays live regardless (it was already safely
-- shipped, and the only other checkout path for a genuinely multi-variant
-- listing throws rather than resolving a correct price). OFF ⇒ a
-- configurator listing reverts to Sprint 2's buy box with no artwork field.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('configurator.enabled', true, 'kill-switch', 'Print-configurator artwork/custom-fields addition (custom-print-products S3) — NOT the underlying variant/tier buy box. OFF ⇒ Sprint 2''s buy box with no artwork field.')
ON CONFLICT (key) DO NOTHING;
