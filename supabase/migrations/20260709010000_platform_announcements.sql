-- Admin content & announcements · Sprint 3 (epic 08 · admin-content-and-announcements) —
-- the announcement primitive. Scheduled, audience-scoped platform comms (feature launches,
-- flash sales, promoted stores) rendered as a seller strip atop /shop/manage and an
-- understated buyer card on the homepage. Editorial/marketing content, not commerce
-- (AGENTS rule #2 → Supabase is the correct home). Additive, scoped to miyagisanchez
-- (shared Supabase).
--
-- Read by the FE only, through the fail-open lib/announcements.ts seam (mirrors
-- lib/copy-overrides.ts / lib/flags.ts's platform_flags pattern). RLS ON with NO
-- policies, so ONLY the service role reads it — the anon key gets zero rows (same
-- "Pattern B" as platform_flags / platform_copy_overrides).
-- Run via Supabase CLI / SQL editor:
--   https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
--
-- Gated by the EXISTING `content.overrides_enabled` kill-switch (lib/flags.ts's doc
-- comment for that key already states it covers "the Sprint 3 announcement banners") —
-- no new flag row needed here.

-- ── Announcement store ────────────────────────────────────────────────────────
--   audience:    'seller' | 'buyer' — which surface renders it
--   text:        the announcement copy (one line, es-MX)
--   cta_label / cta_link: optional call-to-action; link re-validated at render
--                time via httpUrl() (defense-in-depth against a non-http(s) scheme)
--   starts_at / ends_at: schedule bounds; NULL starts_at = live immediately,
--                NULL ends_at = no end date
--   active:      admin intent toggle — "the one campaign in flight for this
--                audience" (whether currently live, upcoming, or past-active).
--                Deactivating hides it for everyone regardless of schedule.
--   updated_by:  clerk_user_id of the admin who last saved it
CREATE TABLE IF NOT EXISTS platform_announcements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audience    TEXT        NOT NULL CHECK (audience IN ('seller', 'buyer')),
  text        TEXT        NOT NULL,
  cta_label   TEXT,
  cta_link    TEXT,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY;

-- One-active-per-audience: DB-level backstop for the app-level activate/replace
-- flow (lib/announcements-admin.ts). A partial unique index rather than a full
-- one, since inactive rows may freely coexist per audience (history/drafts).
CREATE UNIQUE INDEX IF NOT EXISTS platform_announcements_one_active_per_audience
  ON platform_announcements (audience)
  WHERE active;
