-- Admin content & announcements · Sprint 1 (epic 08 · admin-content-and-announcements) —
-- the runtime copy-override store. Marketing copy is otherwise compile-time
-- (locales/{es,en}.json via getDictionary()); this table lets an admin override any
-- already-keyed leaf value with no deploy. Editorial/marketing content, not commerce
-- (AGENTS rule #2 → Supabase is the correct home). Additive, scoped to miyagisanchez
-- (shared Supabase).
--
-- Read by the FE only, through the fail-open lib/copy-overrides.ts seam (mirrors
-- lib/flags.ts's platform_flags pattern — see LEARNINGS: "Copy the platform_flags
-- fail-open read pattern"). RLS ON with NO policies, so ONLY the service role reads it —
-- the anon key gets zero rows (same "Pattern B" as platform_flags /
-- notification_preferences / telegram_link_tokens).
-- Run via Supabase CLI / SQL editor:
--   https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

-- ── Override store ────────────────────────────────────────────────────────────
--   namespace:   top-level locales/*.json key, e.g. 'sellerAcquisition'
--   key:         dot-path within the namespace, e.g. 'anchor.heroTitle' or
--                'promotor.steps.0.title' (numeric segments = array index)
--   locale:      'es' | 'en' — 'en' rows only meaningful on the bilingual
--                allow-list namespaces (lib/bilingual-namespaces.ts); enforced at
--                the write route, not by a DB constraint (the allow-list can grow)
--   value:       the override string; deleting the row restores the compile-time
--                default (the admin editor's «restaurar»)
--   updated_by:  clerk_user_id of the admin who last saved it
CREATE TABLE IF NOT EXISTS platform_copy_overrides (
  namespace   TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  locale      TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  PRIMARY KEY (namespace, key, locale)
);
ALTER TABLE platform_copy_overrides ENABLE ROW LEVEL SECURITY;

-- ── Kill-switch flag (content.overrides_enabled) ──────────────────────────────
-- Seeds ENABLED (= DEFAULT_FLAGS in lib/flags.ts), since this is a kill-switch
-- (default ON) — OFF ⇒ pure compile-time copy + no banners, no admin effect ever.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('content.overrides_enabled', true, 'killswitch', 'Runtime copy-override layer (admin-content-and-announcements). OFF ⇒ pure compile-time locales/*.json copy, no banners, ever.')
ON CONFLICT (key) DO NOTHING;
