-- Sweepstakes — tenant-run growth campaigns.
--
-- Non-commerce promotional data lives in Supabase. Medusa remains the source of
-- truth for products, carts, orders, payments, and refunds.

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_settings (
  id              INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  disabled_reason TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO marketplace_sweepstakes_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_campaigns (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                    UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  medusa_seller_id           TEXT        NOT NULL,
  slug                       TEXT        NOT NULL UNIQUE,
  status                     TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','scheduled','active','completed','cancelled')),
  title_es                   TEXT,
  title_en                   TEXT,
  prize_description_es       TEXT,
  prize_description_en       TEXT,
  prize_image_url            TEXT,
  terms_es                   TEXT,
  terms_en                   TEXT,
  starts_at                  TIMESTAMPTZ,
  ends_at                    TIMESTAMPTZ,
  free_ticket_value          INTEGER     NOT NULL DEFAULT 1 CHECK (free_ticket_value BETWEEN 1 AND 100),
  purchase_bonus_enabled     BOOLEAN     NOT NULL DEFAULT false,
  purchase_ticket_value      INTEGER     NOT NULL DEFAULT 5 CHECK (purchase_ticket_value BETWEEN 1 AND 500),
  organizer_name             TEXT,
  organizer_contact          TEXT,
  permit_reference           TEXT,
  compliance_attested_at     TIMESTAMPTZ,
  compliance_attested_by     TEXT,
  winner_entry_id            UUID,
  winner_ticket_id           UUID,
  winner_masked_contact      TEXT,
  draw_completed_at          TIMESTAMPTZ,
  draw_audit                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  consolation_sent_at        TIMESTAMPTZ,
  created_by                 TEXT        NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_sweepstakes_dates_valid
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT marketplace_sweepstakes_public_legal_gate
    CHECK (
      status IN ('draft','cancelled')
      OR (
        starts_at IS NOT NULL
        AND ends_at IS NOT NULL
        AND length(trim(coalesce(title_es, ''))) > 0
        AND length(trim(coalesce(title_en, ''))) > 0
        AND length(trim(coalesce(prize_description_es, ''))) > 0
        AND length(trim(coalesce(prize_description_en, ''))) > 0
        AND length(trim(coalesce(terms_es, ''))) > 0
        AND length(trim(coalesce(terms_en, ''))) > 0
        AND length(trim(coalesce(organizer_name, ''))) > 0
        AND length(trim(coalesce(organizer_contact, ''))) > 0
        AND length(trim(coalesce(permit_reference, ''))) > 0
        AND compliance_attested_at IS NOT NULL
        AND length(trim(coalesce(compliance_attested_by, ''))) > 0
      )
    )
);

CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_campaigns_shop_idx
  ON marketplace_sweepstakes_campaigns (shop_id);
CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_campaigns_medusa_seller_idx
  ON marketplace_sweepstakes_campaigns (medusa_seller_id);
CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_campaigns_status_ends_idx
  ON marketplace_sweepstakes_campaigns (status, ends_at);

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_email_verifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID        NOT NULL REFERENCES marketplace_sweepstakes_campaigns(id) ON DELETE CASCADE,
  email_hash    TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  code_hash     TEXT        NOT NULL,
  locale        TEXT        NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_verifications_lookup_idx
  ON marketplace_sweepstakes_email_verifications (campaign_id, email_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_entries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID        NOT NULL REFERENCES marketplace_sweepstakes_campaigns(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  email                TEXT        NOT NULL,
  email_hash           TEXT        NOT NULL,
  locale               TEXT        NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  verified_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email_hash)
);

CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_entries_campaign_idx
  ON marketplace_sweepstakes_entries (campaign_id);

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_tickets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES marketplace_sweepstakes_campaigns(id) ON DELETE CASCADE,
  entry_id       UUID        NOT NULL REFERENCES marketplace_sweepstakes_entries(id) ON DELETE CASCADE,
  source         TEXT        NOT NULL CHECK (source IN ('free_entry','purchase_bonus')),
  award_key      TEXT        NOT NULL,
  source_ref     TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  voided_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, award_key)
);

CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_tickets_campaign_idx
  ON marketplace_sweepstakes_tickets (campaign_id)
  WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_tickets_entry_idx
  ON marketplace_sweepstakes_tickets (entry_id)
  WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS marketplace_sweepstakes_tickets_source_ref_idx
  ON marketplace_sweepstakes_tickets (campaign_id, source_ref)
  WHERE source = 'purchase_bonus';

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_draws (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID        NOT NULL UNIQUE REFERENCES marketplace_sweepstakes_campaigns(id) ON DELETE CASCADE,
  winning_ticket_id UUID        NOT NULL REFERENCES marketplace_sweepstakes_tickets(id),
  winning_entry_id  UUID        NOT NULL REFERENCES marketplace_sweepstakes_entries(id),
  ticket_count      INTEGER     NOT NULL,
  pool_hash         TEXT        NOT NULL,
  random_nonce      TEXT        NOT NULL,
  random_value      TEXT        NOT NULL,
  algorithm_version TEXT        NOT NULL DEFAULT 'v1-secure-random-index',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_sweepstakes_broadcasts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL UNIQUE REFERENCES marketplace_sweepstakes_campaigns(id) ON DELETE CASCADE,
  message_es     TEXT        NOT NULL,
  message_en     TEXT        NOT NULL,
  coupon_code    TEXT,
  sent_count     INTEGER     NOT NULL DEFAULT 0,
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS marketplace_sweepstakes_settings_updated_at ON marketplace_sweepstakes_settings;
CREATE TRIGGER marketplace_sweepstakes_settings_updated_at
  BEFORE UPDATE ON marketplace_sweepstakes_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS marketplace_sweepstakes_campaigns_updated_at ON marketplace_sweepstakes_campaigns;
CREATE TRIGGER marketplace_sweepstakes_campaigns_updated_at
  BEFORE UPDATE ON marketplace_sweepstakes_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS marketplace_sweepstakes_entries_updated_at ON marketplace_sweepstakes_entries;
CREATE TRIGGER marketplace_sweepstakes_entries_updated_at
  BEFORE UPDATE ON marketplace_sweepstakes_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
