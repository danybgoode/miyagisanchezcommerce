-- ── Print Edition · Social/Editorial section (Phase 3) ────────────────────────
-- Community-submitted + editor-authored content for the printed edition's social
-- pages ("normal people": a team that won, friends at lunch, a shout-out). Non-
-- commerce editorial data → Supabase (AGENTS rule #2). The editor curates and
-- assigns items to an edition; approved items flow into the export pack.

CREATE TABLE IF NOT EXISTS print_social_submissions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Assigned by the editor; null until placed into a specific issue.
  edition_id              UUID        REFERENCES print_editions(id) ON DELETE SET NULL,
  submitter_clerk_user_id TEXT,
  submitter_name          TEXT,
  submitter_email         TEXT,
  type                    TEXT        NOT NULL DEFAULT 'saludo'
                            CHECK (type IN ('recomendacion','reconocimiento','evento','saludo','otro')),
  caption                 TEXT        NOT NULL,
  body                    TEXT,
  photos                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  zone                    TEXT,
  status                  TEXT        NOT NULL DEFAULT 'submitted'
                            CHECK (status IN ('submitted','approved','placed','rejected')),
  source                  TEXT        NOT NULL DEFAULT 'community'
                            CHECK (source IN ('community','editor')),
  admin_notes             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_social_status_idx    ON print_social_submissions (status);
CREATE INDEX IF NOT EXISTS print_social_edition_idx   ON print_social_submissions (edition_id);
CREATE INDEX IF NOT EXISTS print_social_submitter_idx ON print_social_submissions (submitter_clerk_user_id);

DROP TRIGGER IF EXISTS print_social_submissions_updated_at ON print_social_submissions;
CREATE TRIGGER print_social_submissions_updated_at
  BEFORE UPDATE ON print_social_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
