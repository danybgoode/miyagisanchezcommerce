-- Tiendas Fundadoras acquisition — additive, scoped to miyagisanchez (shared
-- Supabase). The builder does NOT apply this file — the orchestrator applies it
-- by hand (a merged file is NOT an applied migration; verify with to_regclass /
-- information_schema per LEARNINGS "Supabase migration file vs. actually-applied"):
--
--   supabase db query --linked --file supabase/migrations/20260724120000_fundadoras_acquisition.sql
--   supabase migration repair --status applied 20260724120000 --linked
--
-- Never `supabase db push` in this repo — many local files are unrecorded
-- remotely, so a push would replay all of them.
--
-- What this adds, on top of the founding-merchant-activation-ops canonical
-- record (20260723100000_activation_crm_s1.sql):
--   1. Public-application attribution + idempotency on merchant_relationships
--      (the campaign writes into the SAME canonical row — never a second leads
--      table, epic Decision 3).
--   2. An append-only, auditable consent ledger: contact consent and preview
--      permission are SEPARATE affirmative choices (epic Decision 2), each with
--      its own text version + timestamp + source.
--   3. The dark-launch enablement flag growth.founding_merchants_enabled
--      (born OFF).
--
-- CAPACITY MARKER: a founding-cohort member is a merchant_relationships row with
-- cohort='fundadoras'. Capacity ("25 accepted") is:
--   SELECT count(*) FROM merchant_relationships
--     WHERE cohort='fundadoras' AND qualification <> 'disqualified'
-- Server-enforced, read from canonical rows — never a client counter (Story 1.3).
-- `source` stays the traffic-origin attribution (utm_source / referral), distinct
-- from `cohort` which is the finite-cohort membership the count keys on.

-- ── 1. Attribution + idempotency on the canonical relationship ──────────────

-- The full UTM/referral bundle preserved from the public application. `source`
-- (already present) carries the primary origin; this keeps the rest without a
-- column per parameter.
ALTER TABLE merchant_relationships
  ADD COLUMN IF NOT EXISTS utm JSONB;

-- Idempotency for retried submissions (Story 2.1: "retries use one idempotency
-- key"). Distinct from DEDUPE (same person re-applying → enrich, keyed on
-- phone/email in application code): this key makes ONE submission replay-safe.
-- Partial UNIQUE so only real keys are constrained; NULL (every pre-existing
-- backfilled/promoter-captured row) is unaffected.
ALTER TABLE merchant_relationships
  ADD COLUMN IF NOT EXISTS application_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_relationships_idempotency_key_idx
  ON merchant_relationships (application_idempotency_key)
  WHERE application_idempotency_key IS NOT NULL;

-- When the public application first created/enriched this row. NULL for rows
-- that never came through the public campaign (promoter-captured, backfill).
ALTER TABLE merchant_relationships
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Fast capacity + campaign-listing reads.
CREATE INDEX IF NOT EXISTS merchant_relationships_cohort_qualification_idx
  ON merchant_relationships (cohort, qualification);

-- ── 2. Append-only consent ledger ──────────────────────────────────────────
-- Every consent choice is its OWN immutable row. Never overwritten: a later
-- change appends a new row, so the full history (what was granted, under which
-- text version, when, from where) is always auditable. Contact consent and
-- preview permission are separate KINDS — omission of a kind fabricates no
-- permission (Story 2.2: "omission does not fabricate permission").
CREATE TABLE IF NOT EXISTS merchant_relationship_consents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id  UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,

  -- 'contact'            — permission for necessary follow-up (required to apply).
  -- 'preview_permission' — optional: may Miyagi prepare a private preview shop.
  -- 'marketing'          — optional: promotional/marketing channel use.
  kind             TEXT        NOT NULL CHECK (kind IN ('contact', 'preview_permission', 'marketing')),
  granted          BOOLEAN     NOT NULL,

  -- The exact consent-copy version the applicant saw when they chose. Lets an
  -- auditor reconstruct the wording behind any grant.
  text_version     TEXT        NOT NULL,

  -- Where the choice was made, e.g. 'fundadoras_public_application'.
  source           TEXT        NOT NULL,

  -- Who recorded it. 'applicant' = self-declared at the public form.
  actor            TEXT        NOT NULL DEFAULT 'applicant',

  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_relationship_consents_relationship_idx
  ON merchant_relationship_consents (relationship_id, at DESC);

ALTER TABLE merchant_relationship_consents ENABLE ROW LEVEL SECURITY;

-- ── 3. Dark-launch flag (enablement polarity, born OFF) ─────────────────────
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('growth.founding_merchants_enabled', false, 'enablement',
    'Campaña pública de Tiendas Fundadoras: con la flag encendida, /vende/fundadoras acepta solicitudes y la ruta de captura pública queda activa. Con la flag apagada la página muestra un estado cerrado veraz y la ruta de escritura rechaza. La capacidad (25 comercios) se aplica de forma independiente. Actívala solo después de una solicitud de prueba desechable en producción.')
ON CONFLICT (key) DO NOTHING;
