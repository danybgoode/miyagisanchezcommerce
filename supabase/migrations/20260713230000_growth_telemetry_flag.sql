-- growth-engine-v1 (golden-beans Roadmap/01-growth-engine/growth-engine-v1) · Sprint 1,
-- Story 1.3 — seed the growth-telemetry enablement flag into the in-house flag store
-- (epic 09 · feature-flags-inhouse). Behavior-preserving: seeds OFF (= DEFAULT_FLAGS in
-- apps/miyagisanchez/lib/flags.ts), so this is a no-op until an admin deliberately flips
-- it in /admin/flags once golden-beans is deployed and the live-event smoke passes.
--
-- growth.telemetry_enabled gates the setup-guide funnel's telemetry forwarding
-- (app/api/growth/track/route.ts → lib/growth-engine.ts → golden-beans' POST /v1/track).
-- OFF ⇒ zero outbound calls to golden-beans (verified: the route returns { skipped: true }
-- without invoking lib/growth-engine.ts at all). ON ⇒ setup-guide events (guide_view,
-- guide_step_complete, first_share_tap) forward, proving the growth-engine loop on real
-- traffic. This is a standalone telemetry sink, not a money/auth path — a flag outage
-- (fail-open OFF) can never break checkout or any seller-facing surface, it only silences
-- the growth engine's inputs. ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('growth.telemetry_enabled', false, 'enablement',
    'Envío de eventos de la guía de configuración al motor de crecimiento (golden-beans). Actívala cuando golden-beans esté desplegado para empezar a medir el embudo; apagada, no se envía ningún evento.')
ON CONFLICT (key) DO NOTHING;
