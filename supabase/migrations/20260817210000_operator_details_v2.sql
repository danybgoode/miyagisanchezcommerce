-- Operator application details, version 2.
--
-- v1 encoded the "founding proof" program: exactly three candidate shop URLs, an
-- active-shop count of at least three, and a 90-day-checkpoint consent — all enforced
-- here in the CHECK, which is the real contract (the TypeScript validator only mirrors
-- it). The US program is now the same field-operator program `/vende/promotor`
-- describes, and its application is five fields, so the dossier shape no longer
-- describes anything anyone submits.
--
-- v1 stays accepted rather than being rewritten away: dropping a shape a stored row
-- could still be in would turn a historical record into a constraint violation on the
-- next unrelated UPDATE. `marketplace_promoter_applications` was empty when this was
-- written, so this is cheap insurance, not migration work.
--
-- v2 carries `city` and `motivation`, both nullable (motivation is optional on the
-- form, and a null city is better than an invented one). Unknown keys are still
-- rejected, so a future field is a deliberate version bump and not a silent drift.

ALTER TABLE marketplace_promoter_applications
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_operator_details_check;

ALTER TABLE marketplace_promoter_applications
  ADD CONSTRAINT marketplace_promoter_applications_operator_details_check CHECK (
    (program_track = 'promoter' AND operator_details_version IS NULL AND operator_details IS NULL)
    OR
    (program_track = 'founding_operator'
      AND operator_details_version IS NOT NULL
      AND operator_details IS NOT NULL
      AND jsonb_typeof(operator_details) = 'object'
      AND (
        (operator_details_version = 2
          AND operator_details - ARRAY['city', 'motivation'] = '{}'::jsonb)
        OR
        (operator_details_version = 1
          AND CASE
            WHEN jsonb_typeof(operator_details -> 'candidate_shops') = 'array'
              THEN jsonb_array_length(operator_details -> 'candidate_shops') = 3
            ELSE false
          END
          AND CASE
            WHEN (operator_details ->> 'active_shop_count') ~ '^[0-9]+$'
              THEN (operator_details ->> 'active_shop_count')::INTEGER BETWEEN 3 AND 10000
            ELSE false
          END
          AND operator_details -> 'checkpoint_90_day' = 'true'::jsonb
          AND operator_details ?& ARRAY[
            'company_name', 'operator_role', 'active_shop_count', 'candidate_shops',
            'recent_operating_problem', 'must_retain_systems', 'why_now', 'checkpoint_90_day'
          ]
          AND operator_details - ARRAY[
            'company_name', 'operator_role', 'active_shop_count', 'candidate_shops',
            'recent_operating_problem', 'must_retain_systems', 'why_now', 'checkpoint_90_day'
          ] = '{}'::jsonb)
      ))
  );
