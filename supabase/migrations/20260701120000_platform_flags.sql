-- In-house feature flags · Sprint 1 (epic 09 · feature-flags-inhouse) — the owned
-- flag store that replaces the retired SaaS provider. Infra config, not commerce (AGENTS rule #2 →
-- Supabase is the correct home). Additive, scoped to miyagisanchez (shared Supabase).
--
-- Read by BOTH apps through the unchanged isEnabled() seam, in-process cached (60 s)
-- and fail-open: FE via @/lib/supabase (db), BE via the read-only supabaseRead. RLS ON
-- with NO policies, so ONLY the service role (both apps' server clients) reads it —
-- the anon key gets zero rows. Seed = current DEFAULT_FLAGS, so this is a
-- behavior-preserving no-op until a row is deliberately flipped.
-- Run via Supabase CLI / SQL editor:
--   https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

-- ── Flag store ────────────────────────────────────────────────────────────────
--   key:         the FlagKey both apps' lib/flags.ts know about
--   enabled:     the live value isEnabled() returns (absent row ⇒ DEFAULT_FLAGS)
--   polarity:    'killswitch' (default ON) | 'enablement' (default OFF) — doc only
--   updated_by:  clerk_user_id of the admin who last flipped it (S2 write route)
CREATE TABLE IF NOT EXISTS platform_flags (
  key         TEXT        PRIMARY KEY,
  enabled     BOOLEAN     NOT NULL,
  polarity    TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
ALTER TABLE platform_flags ENABLE ROW LEVEL SECURITY;

-- ── Behavior-preserving seed (= current DEFAULT_FLAGS, 2026-07-01) ────────────
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip. 11 flags:
-- checkout.stripe_enabled + pdp_redesign are kill-switches (default ON); the other
-- 9 are enablements (default OFF). ml.sync_enabled is a fail-CLOSED kill-switch by
-- function but seeds OFF (its enforcement lives in the backend + a per-seller enable).
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('checkout.stripe_enabled', true,  'killswitch',  'Stripe checkout rail (BE-enforced). Flip OFF to kill Stripe everywhere.'),
  ('pdp_redesign',            true,  'killswitch',  'The "decide, then act" PDP redesign (epic 01). Flip OFF to revert layout.'),
  ('domain.paywall_enabled',  false, 'enablement',  'Custom-domain SKU paywall (epic 07).'),
  ('events.quantity_enabled', false, 'enablement',  'Buy >1 admission per event in one checkout (epic 10).'),
  ('shipping.envia_enabled',  false, 'enablement',  'Envia.com shipping integration (epic 04, BE-enforced).'),
  ('promoter.enabled',        false, 'enablement',  'Commission-paid promoter program (epic 08).'),
  ('ml.connect_enabled',      false, 'enablement',  'Mercado Libre connect + OAuth surface (epic 03 S1).'),
  ('ml.import_enabled',       false, 'enablement',  'Mercado Libre catalog import surface (epic 03 S2).'),
  ('ml.publish_enabled',      false, 'enablement',  'Mercado Libre publish/predict surface (epic 03 S3).'),
  ('ml.sync_enabled',         false, 'killswitch',  'Two-way ML stock sync (epic 03 S4). Fail-CLOSED: seeds OFF, BE-enforced.'),
  ('subdomain.paywall_enabled', false, 'enablement', 'Subdomain SKU paywall (epic 07, Node-middleware gate).')
ON CONFLICT (key) DO NOTHING;
