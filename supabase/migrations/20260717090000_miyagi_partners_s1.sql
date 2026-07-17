-- Miyagi Partners · Sprint 1 — additive, scoped to miyagisanchez (shared Supabase).
-- Run in the Supabase SQL editor (applied BY HAND at merge time — a merged file is
-- not an applied migration; verify with to_regclass per LEARNINGS).
--
-- Partner identity keys off the approved promoter record (marketplace_promoters —
-- admin-provisioned, PRM- code is the identity), so the partner credential lives
-- as new columns there rather than a new identity table. Grants and the per-call
-- audit trail are genuinely new concepts → new tables (AGENTS rule #2: Medusa has
-- no partner/grant module; commerce data untouched — these only change WHO may
-- call the existing seller MCP tools).

-- Partner credential on the promoter row:
--   * token hash mirrors the ms_agent_ discipline (SHA-256, shown once);
--   * connector slug is PLAINTEXT deliberately — the partner panel must re-show
--     the /api/ucp/mcp/p/<slug> URL, which a hash can't support (same rationale,
--     same rotation semantics as marketplace_shops.metadata.ucp_agent_connector_slug).
ALTER TABLE marketplace_promoters
  ADD COLUMN IF NOT EXISTS partner_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS partner_connector_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoters_partner_token_hash_uniq
  ON marketplace_promoters (partner_token_hash) WHERE partner_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promoters_partner_connector_slug_uniq
  ON marketplace_promoters (partner_connector_slug) WHERE partner_connector_slug IS NOT NULL;

-- One row per partner↔shop grant. Revocation is a timestamp, never a delete —
-- the per-call resolver treats revoked_at IS NOT NULL as absent, and history stays.
CREATE TABLE IF NOT EXISTS partner_grants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID        NOT NULL REFERENCES marketplace_promoters(id),
  shop_id      UUID        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'manager' CHECK (role IN ('manager', 'viewer')),
  granted_by   TEXT        NOT NULL DEFAULT 'admin',   -- 'admin' | 'promoter-close' (S2)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS partner_grants_promoter_idx ON partner_grants (promoter_id);
CREATE INDEX IF NOT EXISTS partner_grants_shop_idx ON partner_grants (shop_id);
-- One ACTIVE grant per partner↔shop pair (a revoked pair may be re-granted fresh).
CREATE UNIQUE INDEX IF NOT EXISTS partner_grants_active_uniq
  ON partner_grants (promoter_id, shop_id) WHERE revoked_at IS NULL;

-- Per-call audit trail — a REAL table (not shop metadata) because partner calls
-- span shops. Written best-effort (lib/agent-audit.ts discipline: a logging
-- failure never fails the call), including DENIED attempts.
CREATE TABLE IF NOT EXISTS partner_tool_calls (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID        NOT NULL,
  shop_id      UUID,                        -- NULL when denial happened before a shop resolved
  shop_slug    TEXT,                        -- what the caller ASKED for (kept even on denial)
  tool         TEXT        NOT NULL,
  role         TEXT,                        -- role held at call time (NULL if no grant)
  outcome      TEXT        NOT NULL CHECK (outcome IN ('ok', 'denied_no_grant', 'denied_role', 'denied_ambiguous', 'denied_revoked')),
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_tool_calls_promoter_idx ON partner_tool_calls (promoter_id, at DESC);
CREATE INDEX IF NOT EXISTS partner_tool_calls_shop_idx ON partner_tool_calls (shop_id, at DESC);

-- Dark-launch flag (enablement polarity, default OFF in every env). With the flag
-- off an ms_partner_ credential resolves as unknown-credential — indistinguishable
-- from a garbage token. Flip only after Daniel's Sprint-1 smoke walkthrough.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('partners.mcp_enabled', false, 'enablement',
    'Credencial multi-tienda ms_partner_ para socios (Miyagi Partners): con la flag apagada, un token de socio se rechaza igual que un token desconocido. Actívala solo tras la prueba en vivo del recorrido de Sprint 1.')
ON CONFLICT (key) DO NOTHING;
