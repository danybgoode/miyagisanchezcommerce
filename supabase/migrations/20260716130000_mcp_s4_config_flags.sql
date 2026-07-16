-- mcp-parity-core S4 — seed the two risky-config-block enablement flags into
-- the in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: both seed OFF (= DEFAULT_FLAGS in apps/miyagisanchez/lib/flags.ts),
-- so a patch_store_configuration call carrying either block is refused whole
-- until Daniel deliberately flips its flag in /admin/flags after the sprint-4.md
-- live smoke.
--
-- mcp.support_config.enabled — gates ONLY the `support` block of the MCP
-- patch_store_configuration tool. Enabling support via agent live-provisions a
-- REAL purchasable Medusa product (same reuse-first backend core as the
-- portal), not pure config — the tool response names the product_id.
-- mcp.checkout_config.enabled — gates ONLY the `checkout` block
-- (escrow_mode/whatsapp_cta/show_phone/cash_pickup.enabled; bank_transfer and
-- contact_email are never agent-settable regardless of this flag).
-- The portal settings surfaces are untouched by both flags either way.
-- Fail-open OFF ⇒ a flag outage can never expose an unsmoked agent config path.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('mcp.support_config.enabled', false, 'enablement',
    'Bloque "support" de patch_store_configuration (MCP): un agente puede configurar los apoyos (propinas) — activarlos crea un producto real en el catálogo. Actívala solo tras la prueba en vivo; apagada, el bloque se rechaza.'),
  ('mcp.checkout_config.enabled', false, 'enablement',
    'Bloque "checkout" de patch_store_configuration (MCP): un agente puede ajustar la presentación del checkout (escrow, WhatsApp, teléfono, efectivo al recoger). La CLABE y el correo de contacto nunca se configuran por agente. Actívala solo tras la prueba en vivo; apagada, el bloque se rechaza.')
ON CONFLICT (key) DO NOTHING;
