-- Bookshop launchpad · Sprint 1 — writer submissions + email-code verification.
--
-- Non-commerce editorial/intake data lives in Supabase (AGENTS rule #2). Medusa
-- remains the source of truth for the PUBLISHED work (a native digital product,
-- minted in Story 1.3) — these tables only hold the pre-publish submission +
-- its curation state, mirroring the sweepstakes entries/verifications shape.
--
-- The manuscript file itself is NOT stored here — only its private-bucket
-- storage key (`manuscript_key`, an R2_BUCKET_DIGITAL object key). The file is
-- served to the shop only via a short-lived presigned URL (Story 1.2); a public
-- URL is never persisted.

-- ── Submissions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS launchpad_submissions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  medusa_seller_id     TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted','in_review','approved','rejected','changes_requested')),
  title                TEXT        NOT NULL,
  synopsis             TEXT,
  genre                TEXT,
  author_name          TEXT        NOT NULL,
  author_email         TEXT        NOT NULL,
  author_email_hash    TEXT        NOT NULL,
  manuscript_key       TEXT        NOT NULL,
  manuscript_name      TEXT,
  manuscript_format    TEXT        NOT NULL CHECK (manuscript_format IN ('pdf','epub','docx')),
  manuscript_size      INTEGER,
  review_note          TEXT,
  published_product_id TEXT,
  locale               TEXT        NOT NULL DEFAULT 'es',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launchpad_submissions_shop_status_idx
  ON launchpad_submissions (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS launchpad_submissions_shop_created_idx
  ON launchpad_submissions (shop_id, created_at DESC);

-- ── Email-code verifications (mirror marketplace_sweepstakes_email_verifications,
--    scoped by shop instead of campaign) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS launchpad_email_verifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  email_hash  TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  locale      TEXT        NOT NULL DEFAULT 'es',
  attempts    INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launchpad_email_verifications_lookup_idx
  ON launchpad_email_verifications (shop_id, email_hash, created_at DESC);

-- ── Kill-switch flag (epic 09 · feature-flags-inhouse) ───────────────────────
-- ENABLEMENT polarity: default OFF so the submission portal + campaigns ship
-- dark. A flag outage can never expose the public upload surface (fail-safe).
-- Flip ON in /admin/flags after Daniel's Sprint 1 money smoke. ON CONFLICT
-- DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('launchpad.enabled', false, 'enablement', 'Bookshop launchpad — writer submission portal + review queue + campaigns (03 · bookshop-launchpad). OFF ⇒ /s/[slug]/convocatoria + all launchpad routes 404/reject.')
ON CONFLICT (key) DO NOTHING;
