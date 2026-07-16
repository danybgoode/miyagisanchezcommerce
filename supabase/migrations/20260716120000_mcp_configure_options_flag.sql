-- mcp-parity-core S2 — seed the configure_listing_options MCP-tool enablement
-- flag into the in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: seeds OFF (= DEFAULT_FLAGS in apps/miyagisanchez/lib/flags.ts),
-- so the tool refuses with "no disponible" until Daniel deliberately flips it in
-- /admin/flags after the live smoke (build a real CPP product via the tool, confirm
-- the PDP price grid + tier ladder + checkout price).
--
-- Gates ONLY the MCP `configure_listing_options` tool (an agent building priced
-- option dimensions / per-combo prices / quantity tiers through the same backend
-- write path as the portal "Opciones" screen). The portal editor is untouched by
-- this flag — it has its own `configurator.enabled` kill-switch. Fail-open OFF ⇒
-- a flag outage can never expose the unsmoked agent write path.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('mcp.configure_options.enabled', false, 'enablement',
    'Herramienta MCP configure_listing_options: un agente puede crear opciones con precio (dimensiones, combinaciones y niveles por cantidad) en un anuncio. Actívala solo tras la prueba en vivo; apagada, la herramienta responde "no disponible".')
ON CONFLICT (key) DO NOTHING;
