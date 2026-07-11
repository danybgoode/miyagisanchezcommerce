-- platform-migrations · Sprint 1 — seed the Shopify connector enablement flag
-- into the in-house flag store (epic 09 · feature-flags-inhouse). Behavior-
-- preserving: seeds OFF (= DEFAULT_FLAGS), so this is a no-op until an admin
-- deliberately flips it in /admin/flags after Daniel's live real-Shopify-domain
-- pull + parity report smoke passes.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('migrations.connector_enabled', false, 'enablement', 'Shopify shop → staged supply-batch connector (platform-migrations S1). OFF ⇒ fetch/import routes + MCP tool + entry point stay hidden.')
ON CONFLICT (key) DO NOTHING;
