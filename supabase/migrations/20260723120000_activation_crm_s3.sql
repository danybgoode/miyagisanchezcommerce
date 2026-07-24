-- Founding merchant activation operations · Sprint 3 — additive, scoped to
-- miyagisanchez (shared Supabase). The builder does NOT apply this file — the
-- orchestrator does, by hand, in this order (a merged file is NOT an applied
-- migration; verify with to_regclass per LEARNINGS "Supabase migration file
-- vs. actually-applied"):
--
--   supabase db query --linked --file supabase/migrations/20260723120000_activation_crm_s3.sql
--   supabase migration repair --status applied 20260723120000 --linked
--
-- Never `supabase db push` in this repo — dozens of local files are
-- unrecorded remotely, so a push would replay all of them.
--
-- What this adds (README D2 — "the 13 stages ARE the event types"):
--   - one nullable `<stage>_at` column on `merchant_lifecycle` per NEWLY
--     added stage event (the other six already have a column from the
--     20260722160000 migration)
--   - `apply_merchant_lifecycle_event` extended IN STEP: the plpgsql
--     vocabulary CHECK now accepts all 14 `merchant.*` event types
--     (lib/merchant-lifecycle.ts#MERCHANT_LIFECYCLE_EVENTS), and the
--     write-once-earliest LEAST() upsert list covers every new column —
--     `CREATE OR REPLACE FUNCTION` in full, per the build contract ("you are
--     modifying that function")
--
-- D1's CONSEQUENCE (comment + re-verified meaning, NOT a data migration):
-- `merchant_lifecycle.merchant_id` (TEXT, unconstrained) now holds
-- `merchant_relationships.id` for every event Sprint 3 onward emits, instead
-- of `marketplace_shops.id`. Verified live on 2026-07-22 (recorded in the
-- epic README): `merchant_lifecycle`, `merchant_lifecycle_deliveries` and
-- `merchant_lifecycle_emissions` each hold ZERO rows in production, so there
-- is no existing history straddling two identity namespaces to reconcile —
-- this is purely a forward-looking meaning change. The column stays TEXT and
-- unconstrained on purpose: it is an OPAQUE subject id on the wire, and a
-- malformed one must be rejected by application-layer validation with a
-- clean 4xx, never by a cast error inside this function.

-- ---------------------------------------------------------------------------
-- 0. Story 3.3 (reconciliation): "last evaluation timestamp" is a real signal,
--    not `updated_at` reused — a steady-state run where nothing advances
--    (facts unchanged) still RAN, and the admin view needs to tell "the sweep
--    checked this an hour ago and found nothing new" apart from "the sweep
--    hasn't looked at this in a week". Written by
--    `lib/merchant-relationship-lifecycle.ts#evaluateRelationship` on EVERY
--    evaluation, whether or not the stage advanced.
-- ---------------------------------------------------------------------------
ALTER TABLE merchant_relationships ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 1. One nullable `<stage>_at` column per newly added stage event.
-- ---------------------------------------------------------------------------
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS scouted_at                 TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS qualified_at               TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS preview_in_preparation_at  TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS preview_delivered_at       TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS activation_scheduled_at    TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS payments_ready_at          TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS shared_externally_at       TIMESTAMPTZ;
ALTER TABLE merchant_lifecycle ADD COLUMN IF NOT EXISTS first_inquiry_at           TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Apply one delivered event — extended vocabulary + upsert list, same
--    single-round-trip / ON CONFLICT DO NOTHING idempotency gate as before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_merchant_lifecycle_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_merchant_id TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_delivery_id TEXT,
  p_payload     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
BEGIN
  -- Defence in depth: the route already validates the vocabulary. Without this a
  -- typo'd type would insert a merchant row with every milestone NULL — a row that
  -- looks like a tracked merchant and means nothing.
  IF p_event_type NOT IN (
    'merchant.scouted',
    'merchant.qualified',
    'merchant.permission_granted',
    'merchant.preview_in_preparation',
    'merchant.preview_delivered',
    'merchant.activation_scheduled',
    'merchant.claimed',
    'merchant.payments_ready',
    'merchant.three_products_live',
    'merchant.shared_externally',
    'merchant.first_inquiry',
    'merchant.first_sale',
    'merchant.retained_30d',
    'merchant.preview_approved'
  ) THEN
    RAISE EXCEPTION 'unknown merchant lifecycle event type: %', p_event_type;
  END IF;

  IF p_merchant_id IS NULL OR btrim(p_merchant_id) = '' THEN
    RAISE EXCEPTION 'merchant id is required';
  END IF;

  INSERT INTO merchant_lifecycle_deliveries
    (event_id, event_type, merchant_id, occurred_at, delivery_id, payload)
  VALUES
    (p_event_id, p_event_type, p_merchant_id, p_occurred_at, p_delivery_id, p_payload)
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF NOT v_inserted THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true);
  END IF;

  INSERT INTO merchant_lifecycle AS m (
    merchant_id, first_seen_at, last_event_at,
    scouted_at, qualified_at, permission_granted_at, preview_in_preparation_at,
    preview_delivered_at, activation_scheduled_at, claimed_at, payments_ready_at,
    three_products_live_at, shared_externally_at, first_inquiry_at, first_sale_at,
    retained_30d_at, preview_approved_at
  ) VALUES (
    p_merchant_id, p_occurred_at, p_occurred_at,
    CASE WHEN p_event_type = 'merchant.scouted'                 THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.qualified'                THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.permission_granted'       THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.preview_in_preparation'   THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.preview_delivered'        THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.activation_scheduled'     THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.claimed'                  THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.payments_ready'           THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.three_products_live'      THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.shared_externally'        THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.first_inquiry'            THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.first_sale'               THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.retained_30d'             THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.preview_approved'         THEN p_occurred_at END
  )
  ON CONFLICT (merchant_id) DO UPDATE SET
    -- LEAST/GREATEST IGNORE NULLs in Postgres, which is exactly the semantics we
    -- want — see the 20260722160000 migration's header for the full walkthrough.
    -- A milestone is write-once-earliest; out-of-order or duplicate delivery of
    -- the same event type still collapses to ONE logical milestone.
    first_seen_at             = LEAST(m.first_seen_at,             EXCLUDED.first_seen_at),
    last_event_at             = GREATEST(m.last_event_at,          EXCLUDED.last_event_at),
    scouted_at                = LEAST(m.scouted_at,                EXCLUDED.scouted_at),
    qualified_at              = LEAST(m.qualified_at,              EXCLUDED.qualified_at),
    permission_granted_at     = LEAST(m.permission_granted_at,     EXCLUDED.permission_granted_at),
    preview_in_preparation_at = LEAST(m.preview_in_preparation_at, EXCLUDED.preview_in_preparation_at),
    preview_delivered_at      = LEAST(m.preview_delivered_at,      EXCLUDED.preview_delivered_at),
    activation_scheduled_at   = LEAST(m.activation_scheduled_at,   EXCLUDED.activation_scheduled_at),
    claimed_at                = LEAST(m.claimed_at,                EXCLUDED.claimed_at),
    payments_ready_at         = LEAST(m.payments_ready_at,         EXCLUDED.payments_ready_at),
    three_products_live_at    = LEAST(m.three_products_live_at,    EXCLUDED.three_products_live_at),
    shared_externally_at      = LEAST(m.shared_externally_at,      EXCLUDED.shared_externally_at),
    first_inquiry_at          = LEAST(m.first_inquiry_at,          EXCLUDED.first_inquiry_at),
    first_sale_at             = LEAST(m.first_sale_at,             EXCLUDED.first_sale_at),
    retained_30d_at           = LEAST(m.retained_30d_at,           EXCLUDED.retained_30d_at),
    preview_approved_at       = LEAST(m.preview_approved_at,       EXCLUDED.preview_approved_at),
    updated_at                = now();

  RETURN jsonb_build_object('applied', true, 'duplicate', false);
END;
$$;

-- The function is only ever called with the service-role key (unchanged posture
-- from the 20260722160000 migration) — reasserted here because CREATE OR REPLACE
-- does not preserve a prior REVOKE.
REVOKE ALL ON FUNCTION apply_merchant_lifecycle_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
