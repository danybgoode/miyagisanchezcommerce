-- custom-print-products · Sprint 3 — seed the configurator kill-switch into the
-- in-house flag store (epic 09 · feature-flags-inhouse). Behavior-preserving:
-- seeds ON (= DEFAULT_FLAGS, matching the `pdp_redesign` kill-switch polarity),
-- so this is a no-op until an admin deliberately flips it OFF in /admin/flags.
--
-- `configurator.enabled` gates the whole print-configurator buy box (multi-
-- variant/tier selection + artwork upload). OFF ⇒ every configurator listing
-- instantly falls back to today's plain PDP buy box (fail-safe).
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('configurator.enabled', true, 'kill-switch', 'Print-configurator buy box — variant/tier selection + artwork upload (custom-print-products S3). OFF ⇒ today''s plain PDP buy box.')
ON CONFLICT (key) DO NOTHING;
