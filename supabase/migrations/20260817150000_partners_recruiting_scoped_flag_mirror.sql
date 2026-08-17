-- Project-relative Golden snapshot versions cannot share one monotonic row.
-- Keep the established primary mirror untouched and give scoped read
-- credentials their own service-role-only, independently monotonic lanes.

CREATE TABLE IF NOT EXISTS golden_flag_scoped_snapshot_mirror (
  provider_scope TEXT NOT NULL CHECK (
    length(provider_scope) BETWEEN 1 AND 64
    AND provider_scope ~ '^[a-z0-9][a-z0-9-]*$'
  ),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'preview', 'production')),
  snapshot_version BIGINT NOT NULL CHECK (snapshot_version >= 0),
  snapshot JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_scope, environment)
);

ALTER TABLE golden_flag_scoped_snapshot_mirror ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE golden_flag_scoped_snapshot_mirror FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION persist_scoped_golden_flag_snapshot(
  p_provider_scope TEXT,
  p_environment TEXT,
  p_snapshot_version BIGINT,
  p_snapshot JSONB
)
RETURNS TABLE (accepted BOOLEAN, current_snapshot_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_row golden_flag_scoped_snapshot_mirror%ROWTYPE;
BEGIN
  IF length(p_provider_scope) NOT BETWEEN 1 AND 64
    OR p_provider_scope !~ '^[a-z0-9][a-z0-9-]*$'
    OR p_environment NOT IN ('development', 'preview', 'production')
    OR p_snapshot_version < 0
    OR p_snapshot IS NULL
    OR p_snapshot ->> 'environment' IS DISTINCT FROM p_environment
    OR p_snapshot ->> 'snapshotVersion' IS NULL
    OR (p_snapshot ->> 'snapshotVersion') !~ '^[0-9]+$'
    OR (p_snapshot ->> 'snapshotVersion')::BIGINT <> p_snapshot_version
    OR jsonb_typeof(p_snapshot -> 'flags') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'invalid scoped Golden flag snapshot mirror payload';
  END IF;

  -- A lane may have no row yet, so row locking alone cannot serialize its
  -- first insert. Lock by both catalog scope and environment.
  PERFORM pg_advisory_xact_lock(hashtextextended('golden_flag_scoped_snapshot_mirror:' || p_provider_scope || ':' || p_environment, 0));
  SELECT * INTO current_row
  FROM golden_flag_scoped_snapshot_mirror
  WHERE provider_scope = p_provider_scope
    AND environment = p_environment
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO golden_flag_scoped_snapshot_mirror (
      provider_scope,
      environment,
      snapshot_version,
      snapshot
    ) VALUES (
      p_provider_scope,
      p_environment,
      p_snapshot_version,
      p_snapshot
    );
    RETURN QUERY SELECT TRUE, p_snapshot_version;
    RETURN;
  END IF;

  IF p_snapshot_version > current_row.snapshot_version THEN
    UPDATE golden_flag_scoped_snapshot_mirror
    SET snapshot_version = p_snapshot_version,
        snapshot = p_snapshot,
        accepted_at = now()
    WHERE provider_scope = p_provider_scope
      AND environment = p_environment;
    RETURN QUERY SELECT TRUE, p_snapshot_version;
    RETURN;
  END IF;

  IF p_snapshot_version = current_row.snapshot_version
    AND p_snapshot = current_row.snapshot
  THEN
    UPDATE golden_flag_scoped_snapshot_mirror
    SET accepted_at = now()
    WHERE provider_scope = p_provider_scope
      AND environment = p_environment;
    RETURN QUERY SELECT TRUE, current_row.snapshot_version;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, current_row.snapshot_version;
END;
$$;

REVOKE ALL ON FUNCTION persist_scoped_golden_flag_snapshot(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION persist_scoped_golden_flag_snapshot(TEXT, TEXT, BIGINT, JSONB) TO service_role;
