-- ── Admin audit log ──────────────────────────────────────────────────────────
-- Accountability trail for platform-admin mutations. Non-commerce ops record →
-- Supabase (AGENTS rule 2). Written best-effort from `withAdmin` on every
-- successful mutating (POST/PATCH/PUT/DELETE) admin call. `payload_summary` is a
-- redacted JSON summary — never stores secrets/tokens. `actor_user_id` is the
-- Clerk user id (null only for legacy machine/secret calls during the dual-accept
-- window; once S2.3 lands, every admin caller is a Clerk identity).

CREATE TABLE admin_audit_log (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id   TEXT,                                    -- Clerk user id
  actor_email     TEXT,
  action          TEXT        NOT NULL,                    -- "PATCH /api/admin/print/social/[id]"
  target          TEXT,                                    -- affected id (best-effort from path)
  payload_summary JSONB       DEFAULT '{}'::jsonb NOT NULL,-- redacted, no secrets
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_actor   ON admin_audit_log(actor_user_id);
