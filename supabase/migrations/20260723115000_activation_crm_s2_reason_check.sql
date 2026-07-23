-- Founding merchant activation operations · Sprint 2 fix round (PR 304
-- review, round 3, D3f/D3g) — an ALTER on the ALREADY-APPLIED
-- 20260723110000_activation_crm_s2.sql. The builder does NOT apply this
-- file — the orchestrator does, by hand, in this order (a merged file is
-- NOT an applied migration; verify with to_regclass / \d per LEARNINGS
-- "Supabase migration file vs. actually-applied"):
--
--   supabase db query --linked --file supabase/migrations/20260723115000_activation_crm_s2_reason_check.sql
--   supabase migration repair --status applied 20260723115000 --linked
--
-- Never `supabase db push` in this repo.
--
-- D3f — the original CHECK on merchant_relationship_transitions,
-- `(dedupe_key NOT LIKE 'correction:%' OR reason IS NOT NULL)`, accepts an
-- EMPTY-STRING reason: '' IS NOT NULL, so a correction with `reason: ''`
-- passes the constraint the build contract calls "a correction requires a
-- reason — enforced by a DB CHECK, not just route code" — the route already
-- rejects a blank reason (422), but the DB's OWN independent backstop
-- didn't actually require a NON-BLANK one, only a non-NULL one. Tightened to
-- `btrim(reason) <> ''`.
--
-- The exact name Postgres auto-generated for that anonymous CHECK depends on
-- how many anonymous constraints preceded it in the original CREATE TABLE
-- statement, which this file has no reliable way to guess — so the DO block
-- below finds and drops it by its DEFINITION (searching for the
-- `dedupe_key`/`correction`/`reason` text every version of that constraint
-- has contained) rather than by a hardcoded name. Idempotent: after the
-- first run, no constraint matches the search and the loop is a no-op.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'merchant_relationship_transitions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%dedupe_key%'
      AND pg_get_constraintdef(oid) ILIKE '%correction%'
      AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE merchant_relationship_transitions DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'merchant_relationship_transitions'::regclass
      AND conname = 'merchant_relationship_transitions_correction_reason_check'
  ) THEN
    ALTER TABLE merchant_relationship_transitions
      ADD CONSTRAINT merchant_relationship_transitions_correction_reason_check
      CHECK (dedupe_key NOT LIKE 'correction:%' OR btrim(reason) <> '');
  END IF;
END $$;

-- D3g — `to_stage_ordinal` was never tied to `to_stage` at the database
-- level: `{to_stage: 'claimed', to_stage_ordinal: 13}` passed every existing
-- constraint (each column's own CHECK validates independently), and Sprint
-- 3's reconciliation view is DOCUMENTED to trust `to_stage_ordinal` directly
-- rather than re-deriving it from `to_stage` every read. A CHECK enumerating
-- the 13 valid (to_stage, to_stage_ordinal) pairs — the same frozen mapping
-- `lib/merchant-stage.ts#STAGE_ORDINAL` defines in code — closes that gap at
-- the one layer that can't be bypassed by a future writer skipping the
-- application layer entirely.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'merchant_relationship_transitions'::regclass
      AND conname = 'merchant_relationship_transitions_stage_ordinal_check'
  ) THEN
    ALTER TABLE merchant_relationship_transitions
      ADD CONSTRAINT merchant_relationship_transitions_stage_ordinal_check
      CHECK (
        (to_stage = 'scouted'                 AND to_stage_ordinal = 1)  OR
        (to_stage = 'qualified'               AND to_stage_ordinal = 2)  OR
        (to_stage = 'permission_granted'      AND to_stage_ordinal = 3)  OR
        (to_stage = 'preview_in_preparation'  AND to_stage_ordinal = 4)  OR
        (to_stage = 'preview_delivered'       AND to_stage_ordinal = 5)  OR
        (to_stage = 'activation_scheduled'    AND to_stage_ordinal = 6)  OR
        (to_stage = 'claimed'                 AND to_stage_ordinal = 7)  OR
        (to_stage = 'payments_ready'          AND to_stage_ordinal = 8)  OR
        (to_stage = 'three_products_live'     AND to_stage_ordinal = 9)  OR
        (to_stage = 'shared_externally'       AND to_stage_ordinal = 10) OR
        (to_stage = 'first_inquiry'           AND to_stage_ordinal = 11) OR
        (to_stage = 'first_sale'              AND to_stage_ordinal = 12) OR
        (to_stage = 'retained_30d'            AND to_stage_ordinal = 13)
      );
  END IF;
END $$;
