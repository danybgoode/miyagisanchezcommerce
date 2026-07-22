-- Founding merchant consent-safe previews · Sprint 4 — merchant-verified approval.
-- Additive, scoped to miyagisanchez (shared Supabase).
--
-- Apply with the Supabase CLI (a merged file is NOT an applied migration):
--   supabase db query --linked --file supabase/migrations/20260722180000_consent_previews_verified_approval.sql
--   supabase migration repair --status applied 20260722180000 --linked
-- Do NOT use `supabase db push` in this repo (shared instance + hand-applied history).

-- ---------------------------------------------------------------------------
-- 1. The one-time approval-code store. One row per issued code.
-- ---------------------------------------------------------------------------
-- Same discipline as launchpad_campaign_verifications / sweepstakes: the plaintext
-- code is emailed once and NEVER stored — only its HMAC (lib/sweepstakes.ts
-- hashVerificationCode) lands here. The scope of the hash is the preview id + the
-- APPROVED SNAPSHOT HASH, so a code issued for one proposal cannot verify an
-- approval of a different (edited) proposal.
--
-- This is the artifact that converts "the promoter holds the preview link" into
-- "someone holds the merchant's own contact": the code is delivered to the
-- merchant's email/WhatsApp, and a decision can only be recorded as `approved`
-- (under the flag) once a code delivered to that contact is presented back.
CREATE TABLE IF NOT EXISTS merchant_preview_approval_codes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id     UUID        NOT NULL REFERENCES merchant_previews(id) ON DELETE CASCADE,
  -- The snapshot hash the code was issued FOR (lib/preview-snapshot.ts). A code is
  -- only valid to approve the exact proposal it was sent for.
  snapshot_hash  TEXT        NOT NULL,
  -- HMAC of the code (never the code). Scoped by preview+snapshot+contact.
  code_hash      TEXT        NOT NULL,
  -- HMAC of the contact the code was DELIVERED to (email or E.164 phone) — proves
  -- the linkage without storing the raw contact. This is the provable "who".
  contact_hash   TEXT        NOT NULL,
  -- How the code was delivered. Recorded on the decision as `verified_via`.
  channel        TEXT        NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  attempts       INTEGER     NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-unconsumed lookup by preview (the verify path reads the newest live code).
CREATE INDEX IF NOT EXISTS merchant_preview_approval_codes_preview_idx
  ON merchant_preview_approval_codes (preview_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Provenance on the consent record itself.
-- ---------------------------------------------------------------------------
-- The approval decision now carries HOW it was verified and to WHICH contact
-- (hashed). NULL = a legacy or flag-off approval with no merchant-verified factor,
-- honestly labeled rather than back-filled. `checkActivation` treats a flag-ON
-- approval with `verified_via IS NULL` as not a current approval.
ALTER TABLE merchant_preview_decisions
  ADD COLUMN IF NOT EXISTS verified_via          TEXT
    CHECK (verified_via IS NULL OR verified_via IN ('email', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS verified_contact_hash TEXT;

-- Same posture as the sibling consent tables: RLS ON, no policies. These rows ARE
-- the merchant-identity factor — a client able to insert a consumed code, or read
-- the code hashes, could forge or replay merchant consent. The app reaches Supabase
-- only via the service-role key, which bypasses RLS.
ALTER TABLE merchant_preview_approval_codes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. The dark-launch flag (enablement polarity, default OFF everywhere).
-- ---------------------------------------------------------------------------
-- Independent of `promoter.private_preview_enabled`: verified approval TIGHTENS an
-- already-live feature, so the epic's own flag flip does not wait on this, and this
-- can turn on later after a real merchant round-trip smoke. ON → approval requires
-- a verified code; OFF → approval behaves exactly as it does today.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('promoter.preview_verified_approval_enabled', false, 'enablement',
    'Aprobación verificada del comerciante para vistas previas privadas: con la flag encendida, aprobar una propuesta exige un código de un solo uso enviado al correo (o WhatsApp) del comerciante, de modo que la aprobación quede ligada a quien controla ese contacto. Actívala solo tras probar el recorrido con un comerciante real.')
ON CONFLICT (key) DO NOTHING;
