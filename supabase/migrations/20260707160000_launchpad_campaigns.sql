-- Bookshop launchpad · Sprint 3 — voting campaigns + the 50% print unlock.
--
-- A bookshop runs a campaign over already-published launchpad works: readers cast
-- one email-verified vote per work, and when the campaign's total verified votes
-- reach `vote_threshold`, an auto-minted, PRODUCT-SCOPED coupon unlocks a discount
-- (default 50%) on a linked custom-print-products (CPP) print listing. Threshold
-- unmet at `ends_at` → an honest close, no coupon.
--
-- Legal framing (recorded in sprint-3.md): a vote THRESHOLD unlocking a fixed,
-- known discount is NOT a chance-based prize → not a SEGOB sweepstake. We still
-- adopt the sweepstakes spine's conservative posture (email-verified votes, honest
-- counts, explicit terms, a global kill-switch). Non-commerce vote/intake data lives
-- in Supabase (AGENTS rule #2); the coupon + print product remain Medusa's.
--
-- Shapes deliberately mirror `marketplace_sweepstakes_*` (es-MX only — no bilingual
-- columns) and the S1 `launchpad_*` tables, so the same helpers/patterns carry over.

-- ── Campaigns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS launchpad_campaigns (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  medusa_seller_id    TEXT        NOT NULL,
  slug                TEXT        NOT NULL UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','closed_met','closed_unmet','cancelled')),
  title               TEXT,
  description         TEXT,
  terms               TEXT,
  vote_threshold      INTEGER     NOT NULL DEFAULT 0 CHECK (vote_threshold >= 0),
  ends_at             TIMESTAMPTZ,
  reward_percent      INTEGER     NOT NULL DEFAULT 50 CHECK (reward_percent BETWEEN 1 AND 100),
  reward_product_id   TEXT,
  -- Minted-coupon linkage (Story 3.3). `coupon_promotion_id` doubles as the
  -- optimistic-mint claim: a non-null value means the coupon exists (or is being
  -- minted), so a threshold re-fire never double-mints.
  coupon_code         TEXT,
  coupon_promotion_id TEXT,
  minted_at           TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  closed_notified_at  TIMESTAMPTZ,
  created_by          TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Activation gate: an active (or closed) campaign MUST carry the load-bearing
  -- fields. `ends_at` must be in the FUTURE and `reward_product_id` must be a
  -- CPP-configured product — both enforced in the route (a CHECK can't call now()
  -- nor reach Medusa). This constraint is the DB-side backstop for the rest.
  CONSTRAINT launchpad_campaigns_activation_gate CHECK (
    status IN ('draft','cancelled')
    OR (
      vote_threshold > 0
      AND ends_at IS NOT NULL
      AND reward_product_id IS NOT NULL
      AND length(trim(coalesce(title, ''))) > 0
      AND length(trim(coalesce(description, ''))) > 0
    )
  )
);

CREATE INDEX IF NOT EXISTS launchpad_campaigns_shop_status_idx
  ON launchpad_campaigns (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS launchpad_campaigns_status_ends_idx
  ON launchpad_campaigns (status, ends_at);

-- ── Candidate works (published launchpad digital products) ───────────────────
CREATE TABLE IF NOT EXISTS launchpad_campaign_works (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID        NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  product_id  TEXT        NOT NULL,
  position    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, product_id)
);

CREATE INDEX IF NOT EXISTS launchpad_campaign_works_campaign_idx
  ON launchpad_campaign_works (campaign_id, position);

-- ── Votes — one verified vote per email PER WORK ─────────────────────────────
-- The UNIQUE key enforces "one vote per email per work": a voter may vote for
-- several works (once each). Campaign progress = count(*) of votes for the
-- campaign (honest — never a stored/inflated counter).
CREATE TABLE IF NOT EXISTS launchpad_campaign_votes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  work_product_id TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  email_hash      TEXT        NOT NULL,
  locale          TEXT        NOT NULL DEFAULT 'es',
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, work_product_id, email_hash)
);

CREATE INDEX IF NOT EXISTS launchpad_campaign_votes_campaign_idx
  ON launchpad_campaign_votes (campaign_id);
CREATE INDEX IF NOT EXISTS launchpad_campaign_votes_email_idx
  ON launchpad_campaign_votes (campaign_id, email_hash);

-- ── Email-code verifications (campaign-scoped) ───────────────────────────────
-- Mirror of `launchpad_email_verifications`, scoped by campaign instead of shop.
CREATE TABLE IF NOT EXISTS launchpad_campaign_verifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID        NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  email_hash  TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  locale      TEXT        NOT NULL DEFAULT 'es',
  attempts    INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launchpad_campaign_verifications_lookup_idx
  ON launchpad_campaign_verifications (campaign_id, email_hash, created_at DESC);

-- updated_at trigger (shared helper, same as the sweepstakes/launchpad tables).
DROP TRIGGER IF EXISTS launchpad_campaigns_updated_at ON launchpad_campaigns;
CREATE TRIGGER launchpad_campaigns_updated_at
  BEFORE UPDATE ON launchpad_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Kill-switch: reuse the epic-wide `launchpad.enabled` flag (seeded in
-- 20260707130000_bookshop_launchpad.sql). No new flag — campaigns share the
-- fail-safe-OFF polarity; the public /v/[slug] surface additionally stays gated
-- until Daniel's Sprint 3 money smoke.
