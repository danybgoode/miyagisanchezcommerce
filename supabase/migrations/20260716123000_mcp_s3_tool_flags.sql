-- mcp-parity-core S3 — seed the two money-adjacent MCP-tool enablement flags
-- into the in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: both seed OFF (= DEFAULT_FLAGS in apps/miyagisanchez/lib/flags.ts),
-- so each tool refuses with "no disponible" until Daniel deliberately flips it in
-- /admin/flags after its live smoke (sprint-3.md walkthrough).
--
-- mcp.delete_listing.enabled — gates ONLY the MCP `delete_listing` tool (agent
-- soft-delete of an owned listing, same native Medusa soft-delete as the portal;
-- order line-items keep resolving). The portal delete is untouched either way.
-- mcp.apply_price.enabled — gates ONLY the MCP `apply_price` tool (agent
-- one-click price apply through the Profit Analyzer pipeline: Miyagi write +
-- conditional ML push + activity log). The portal Apply keeps its own
-- ops.profit_enabled gate either way.
-- Fail-open OFF ⇒ a flag outage can never expose an unsmoked agent money path.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('mcp.delete_listing.enabled', false, 'enablement',
    'Herramienta MCP delete_listing: un agente puede eliminar (borrado suave) un anuncio de su propia tienda. Actívala solo tras la prueba en vivo; apagada, la herramienta responde "no disponible".'),
  ('mcp.apply_price.enabled', false, 'enablement',
    'Herramienta MCP apply_price: un agente puede aplicar un precio calculado a una variante en vivo (mismo flujo que el Aplicar del Analizador de ganancias). Actívala solo tras la prueba en vivo con carrito; apagada, la herramienta responde "no disponible".')
ON CONFLICT (key) DO NOTHING;
