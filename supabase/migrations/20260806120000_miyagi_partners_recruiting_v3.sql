-- Miyagi Partners recruiting v3 · Sprint 1 — additive identity + application contract.
-- This file is applied by the orchestrator, never by the builder. All functions are
-- service-role-only because they cross the application/identity authorization seam.

ALTER TABLE marketplace_promoters
  ADD COLUMN IF NOT EXISTS program_track TEXT NOT NULL DEFAULT 'promoter';

ALTER TABLE marketplace_promoters
  DROP CONSTRAINT IF EXISTS marketplace_promoters_program_track_check;
ALTER TABLE marketplace_promoters
  ADD CONSTRAINT marketplace_promoters_program_track_check
  CHECK (program_track IN ('promoter', 'founding_operator'));

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoters_clerk_user_id_uniq
  ON marketplace_promoters (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

ALTER TABLE marketplace_promoter_applications
  ADD COLUMN IF NOT EXISTS program_track TEXT NOT NULL DEFAULT 'promoter',
  ADD COLUMN IF NOT EXISTS operator_details_version SMALLINT,
  ADD COLUMN IF NOT EXISTS operator_details JSONB,
  ADD COLUMN IF NOT EXISTS activation_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activation_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_provider_status TEXT,
  ADD COLUMN IF NOT EXISTS invitation_attempt_count INTEGER,
  ADD COLUMN IF NOT EXISTS invitation_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_provider_accepted_at TIMESTAMPTZ;

ALTER TABLE marketplace_promoter_applications
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_program_track_check,
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_status_check,
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_operator_details_check,
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_activation_check,
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_invitation_delivery_check,
  DROP CONSTRAINT IF EXISTS marketplace_promoter_applications_invitation_provider_check;

ALTER TABLE marketplace_promoter_applications
  ADD CONSTRAINT marketplace_promoter_applications_program_track_check
    CHECK (program_track IN ('promoter', 'founding_operator')),
  ADD CONSTRAINT marketplace_promoter_applications_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT marketplace_promoter_applications_operator_details_check CHECK (
    (program_track = 'promoter' AND operator_details_version IS NULL AND operator_details IS NULL)
    OR
    (program_track = 'founding_operator'
      AND operator_details_version IS NOT NULL
      AND operator_details IS NOT NULL
      AND operator_details_version = 1
      AND jsonb_typeof(operator_details) = 'object'
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
  ),
  ADD CONSTRAINT marketplace_promoter_applications_activation_check CHECK (
    (program_track = 'promoter'
      AND activation_token_hash IS NULL AND activation_expires_at IS NULL AND activation_used_at IS NULL
      AND invitation_provider_status IS NULL AND invitation_attempt_count IS NULL
      AND invitation_attempted_at IS NULL AND invitation_provider_accepted_at IS NULL)
    OR (program_track = 'founding_operator' AND (
      (status IN ('pending', 'rejected')
        AND activation_token_hash IS NULL AND activation_expires_at IS NULL AND activation_used_at IS NULL
        AND invitation_provider_status IS NULL AND invitation_attempt_count IS NULL
        AND invitation_attempted_at IS NULL AND invitation_provider_accepted_at IS NULL)
      OR
      (status = 'approved'
        AND activation_token_hash IS NOT NULL
        AND activation_token_hash ~ '^[0-9a-f]{64}$'
        AND activation_expires_at IS NOT NULL
        AND invitation_provider_status IS NOT NULL
        AND invitation_provider_status IN ('pending', 'provider_accepted', 'unconfirmed')
        AND invitation_attempt_count IS NOT NULL AND invitation_attempt_count >= 0)
    ))
  ),
  ADD CONSTRAINT marketplace_promoter_applications_invitation_provider_check CHECK (
    invitation_provider_status IS NULL
    OR (invitation_provider_status = 'pending' AND invitation_provider_accepted_at IS NULL)
    OR (invitation_provider_status = 'provider_accepted' AND invitation_attempt_count >= 1
      AND invitation_attempted_at IS NOT NULL AND invitation_provider_accepted_at IS NOT NULL)
    OR (invitation_provider_status = 'unconfirmed' AND invitation_attempt_count >= 1
      AND invitation_attempted_at IS NOT NULL AND invitation_provider_accepted_at IS NULL)
  );

-- One unresolved review per normalized operator email. Approved rows remain in the
-- set so an approved identity cannot silently acquire a second pending application;
-- rejected applicants may submit a new application.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoter_applications_operator_active_email_uniq
  ON marketplace_promoter_applications (lower(email))
  WHERE program_track = 'founding_operator' AND status IN ('pending', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoter_applications_activation_token_hash_uniq
  ON marketplace_promoter_applications (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('partners.recruiting_v3_enabled', false, 'enablement',
   'Miyagi Partners recruiting v3: US proposition, founding-operator intake, neutral activation and track-aware workspace orientation. Keep OFF until the full operator/Promotor authorization smoke passes.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION miyagi_bind_partner_identity(
  p_promoter_id UUID,
  p_clerk_user_id TEXT
) RETURNS marketplace_promoters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_identity marketplace_promoters;
BEGIN
  IF p_clerk_user_id IS NULL OR btrim(p_clerk_user_id) = '' THEN
    RAISE EXCEPTION 'invalid_clerk_user_id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_identity
  FROM marketplace_promoters
  WHERE id = p_promoter_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'identity_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_identity.clerk_user_id = p_clerk_user_id THEN
    RETURN v_identity;
  END IF;
  IF v_identity.clerk_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'identity_already_bound' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM marketplace_promoters
    WHERE clerk_user_id = p_clerk_user_id AND id <> p_promoter_id
  ) THEN
    RAISE EXCEPTION 'clerk_user_already_bound' USING ERRCODE = '23505';
  END IF;

  UPDATE marketplace_promoters
  SET clerk_user_id = p_clerk_user_id
  WHERE id = p_promoter_id
  RETURNING * INTO v_identity;
  RETURN v_identity;
END;
$$;

CREATE OR REPLACE FUNCTION miyagi_approve_founding_operator_application(
  p_application_id UUID,
  p_activation_token_hash TEXT,
  p_activation_expires_at TIMESTAMPTZ
) RETURNS marketplace_promoter_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application marketplace_promoter_applications;
  v_identity marketplace_promoters;
BEGIN
  IF p_activation_token_hash IS NULL OR p_activation_token_hash !~ '^[0-9a-f]{64}$'
     OR p_activation_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_activation_material' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_application
  FROM marketplace_promoter_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_application.program_track <> 'founding_operator' OR v_application.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_application_transition' USING ERRCODE = '55000';
  END IF;

  INSERT INTO marketplace_promoters (code, name, program_track)
  VALUES (
    'MYP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_application.name,
    'founding_operator'
  ) RETURNING * INTO v_identity;

  UPDATE marketplace_promoter_applications
  SET status = 'approved',
      promoter_id = v_identity.id,
      decided_at = now(),
      activation_token_hash = p_activation_token_hash,
      activation_expires_at = p_activation_expires_at,
      activation_used_at = NULL,
      invitation_provider_status = 'pending',
      invitation_attempt_count = 0,
      invitation_attempted_at = NULL,
      invitation_provider_accepted_at = NULL
  WHERE id = p_application_id
  RETURNING * INTO v_application;
  RETURN v_application;
END;
$$;

CREATE OR REPLACE FUNCTION miyagi_rotate_founding_operator_invitation(
  p_application_id UUID,
  p_activation_token_hash TEXT,
  p_activation_expires_at TIMESTAMPTZ
) RETURNS marketplace_promoter_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application marketplace_promoter_applications;
BEGIN
  IF p_activation_token_hash IS NULL OR p_activation_token_hash !~ '^[0-9a-f]{64}$'
     OR p_activation_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_activation_material' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_application
  FROM marketplace_promoter_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_application.program_track <> 'founding_operator'
     OR v_application.status <> 'approved'
     OR v_application.promoter_id IS NULL
     OR v_application.activation_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_not_rotatable' USING ERRCODE = '55000';
  END IF;

  UPDATE marketplace_promoter_applications
  SET activation_token_hash = p_activation_token_hash,
      activation_expires_at = p_activation_expires_at,
      invitation_provider_status = 'pending',
      invitation_provider_accepted_at = NULL
  WHERE id = p_application_id
  RETURNING * INTO v_application;
  RETURN v_application;
END;
$$;

CREATE OR REPLACE FUNCTION miyagi_record_founding_operator_invitation_outcome(
  p_application_id UUID,
  p_activation_token_hash TEXT,
  p_provider_outcome TEXT
) RETURNS marketplace_promoter_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application marketplace_promoter_applications;
BEGIN
  IF p_activation_token_hash IS NULL OR p_activation_token_hash !~ '^[0-9a-f]{64}$'
     OR p_provider_outcome IS NULL OR p_provider_outcome NOT IN ('provider_accepted', 'unconfirmed') THEN
    RAISE EXCEPTION 'invalid_invitation_outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_application
  FROM marketplace_promoter_applications
  WHERE id = p_application_id
    AND activation_token_hash = p_activation_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stale_invitation_result' USING ERRCODE = '55000'; END IF;
  IF v_application.program_track <> 'founding_operator'
     OR v_application.status <> 'approved'
     OR v_application.activation_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_not_recordable' USING ERRCODE = '55000';
  END IF;
  IF v_application.invitation_provider_status = p_provider_outcome THEN
    RETURN v_application;
  END IF;
  IF v_application.invitation_provider_status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_result_already_recorded' USING ERRCODE = '55000';
  END IF;

  UPDATE marketplace_promoter_applications
  SET invitation_provider_status = p_provider_outcome,
      invitation_attempt_count = coalesce(invitation_attempt_count, 0) + 1,
      invitation_attempted_at = now(),
      invitation_provider_accepted_at = CASE WHEN p_provider_outcome = 'provider_accepted' THEN now() ELSE NULL END
  WHERE id = p_application_id
    AND activation_token_hash = p_activation_token_hash
  RETURNING * INTO v_application;
  RETURN v_application;
END;
$$;

CREATE OR REPLACE FUNCTION miyagi_activate_founding_operator(
  p_activation_token_hash TEXT,
  p_clerk_user_id TEXT,
  p_verified_emails TEXT[]
) RETURNS marketplace_promoter_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application marketplace_promoter_applications;
BEGIN
  SELECT * INTO v_application
  FROM marketplace_promoter_applications
  WHERE activation_token_hash = p_activation_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'activation_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_application.program_track <> 'founding_operator'
     OR v_application.status <> 'approved'
     OR v_application.promoter_id IS NULL
     OR v_application.activation_used_at IS NOT NULL
     OR v_application.activation_expires_at <= now() THEN
    RAISE EXCEPTION 'activation_invalid' USING ERRCODE = '55000';
  END IF;
  IF p_verified_emails IS NULL OR NOT EXISTS (
    SELECT 1
    FROM unnest(p_verified_emails) AS verified_email
    WHERE lower(btrim(verified_email)) = lower(btrim(v_application.email))
  ) THEN
    RAISE EXCEPTION 'activation_principal_mismatch' USING ERRCODE = '42501';
  END IF;

  PERFORM miyagi_bind_partner_identity(v_application.promoter_id, p_clerk_user_id);
  UPDATE marketplace_promoter_applications
  SET activation_used_at = now()
  WHERE id = v_application.id
  RETURNING * INTO v_application;
  RETURN v_application;
END;
$$;

REVOKE ALL ON FUNCTION miyagi_bind_partner_identity(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION miyagi_approve_founding_operator_application(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION miyagi_rotate_founding_operator_invitation(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION miyagi_record_founding_operator_invitation_outcome(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION miyagi_activate_founding_operator(TEXT, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION miyagi_bind_partner_identity(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION miyagi_approve_founding_operator_application(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION miyagi_rotate_founding_operator_invitation(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION miyagi_record_founding_operator_invitation_outcome(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION miyagi_activate_founding_operator(TEXT, TEXT, TEXT[]) TO service_role;
