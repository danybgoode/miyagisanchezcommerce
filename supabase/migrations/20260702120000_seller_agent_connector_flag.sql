-- Seller agent connect · Sprint 2 (epic 03 · seller-agent-connect-mcp-url) — seed the
-- personal-MCP-URL kill-switch into the in-house flag store (epic 09 ·
-- feature-flags-inhouse). Behavior-preserving: seeds OFF (= DEFAULT_FLAGS), so this is
-- a no-op until the auth `api` specs are green AND Daniel's live claude.ai connector
-- round-trip smoke passes — then an admin deliberately flips it in /admin/flags.
--
-- `seller_agent.connector_url_enabled` gates a NEW authentication path to
-- seller-scoped MCP tools (`/api/ucp/mcp/c/<slug>`) — off ⇒ the URL route 404s and
-- the connect panel shows only the existing Bearer-token flow. ON CONFLICT DO NOTHING
-- so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('seller_agent.connector_url_enabled', false, 'enablement', 'Personal MCP URL + Claude one-click (epic 03 S2). OFF ⇒ legacy Bearer-token flow only.')
ON CONFLICT (key) DO NOTHING;
