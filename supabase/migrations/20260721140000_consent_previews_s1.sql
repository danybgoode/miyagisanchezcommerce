-- Founding merchant consent-safe previews · Sprint 1 — additive, scoped to
-- miyagisanchez (shared Supabase). Run in the Supabase SQL editor: a merged file
-- is NOT an applied migration — apply BY HAND and verify with to_regclass /
-- the flag row (per LEARNINGS "Supabase migration file vs. actually-applied").
--
-- What this epic adds (non-commerce only — AGENTS rule #2): the consent/preview
-- LIFECYCLE and the opaque preview-link grants. Commerce visibility itself is NOT
-- modeled here — a preview product is a native Medusa `status:'draft'` product,
-- already excluded from every public /store/* read seam (search, PDP, seller
-- products, sitemap, agent, embed). These tables only record WHO may privately
-- review the proposal and WHETHER/WHEN it was approved for public activation.

-- One preview anchor per shop. `status` is the consent lifecycle; the full set is
-- declared now (forward-compatible for Sprint 2/3) though S1 only ever writes
-- 'draft'. `current_version` is bumped by S2 when a material edit invalidates
-- approval. A shop with a row here whose status <> 'activated' is preview-private:
-- the public shop-shell readers (S1.2 leak guard) treat it as absent.
CREATE TABLE IF NOT EXISTS merchant_previews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'delivered', 'changes_requested',
                                      'approved', 'invalidated', 'activated')),
  current_version INTEGER     NOT NULL DEFAULT 0,
  created_by      TEXT        NOT NULL,          -- promoter clerk_user_id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One shop has at most one live preview anchor.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_previews_shop_uniq
  ON merchant_previews (shop_id);

-- Opaque, revocable preview-link grants. Same SHA-256 storage discipline as the
-- ms_agent_/ms_partner_ credentials (lib/agent-auth.ts): the plaintext token is
-- shown once, only its hash is stored. Revocation is a timestamp, never a delete
-- (the resolver treats revoked_at IS NOT NULL as absent → 404, and history stays).
CREATE TABLE IF NOT EXISTS merchant_preview_grants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id   UUID        NOT NULL REFERENCES merchant_previews(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,
  created_by   TEXT        NOT NULL,             -- promoter clerk_user_id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,                      -- NULL = no expiry
  revoked_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_preview_grants_token_hash_uniq
  ON merchant_preview_grants (token_hash);
CREATE INDEX IF NOT EXISTS merchant_preview_grants_preview_idx
  ON merchant_preview_grants (preview_id);

-- RLS: ON with NO policies, on BOTH tables. These rows are the consent record —
-- a client that could flip a preview to 'activated' would publish a merchant's
-- shop without approval, and a client that could read the grants table would see
-- which merchants are being pitched. The app reaches Supabase exclusively through
-- the SERVICE-ROLE key, which bypasses RLS, so enabling it costs the app nothing
-- while removing anon/authenticated access entirely under standard public-schema
-- grants. (Deliberately stricter than the newest sibling `partner_grants`, which
-- shipped without it — that is a gap to close there, not a precedent to copy.)
ALTER TABLE merchant_previews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_preview_grants ENABLE ROW LEVEL SECURITY;

-- Dark-launch flag (enablement polarity, default OFF in every env). Gates the
-- promoter setup/listing orchestration seam: ON creates private draft products +
-- signed preview access; OFF preserves the current force-publish route for
-- rollback. Flip only after a disposable shop passes the full channel sweep.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('promoter.private_preview_enabled', false, 'enablement',
    'Vista previa privada para tiendas creadas por promotores (Founding Merchant): con la flag encendida, los productos se crean como borrador privado y se genera un enlace de vista previa revocable en vez de publicarse de inmediato. Actívala solo tras la prueba en vivo del recorrido de Sprint 1.')
ON CONFLICT (key) DO NOTHING;
