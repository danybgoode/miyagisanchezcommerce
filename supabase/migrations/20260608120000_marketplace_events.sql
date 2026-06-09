-- Events & Ticketing S2 — free RSVP events.
--
-- Free RSVP data is non-commerce marketplace state. Paid admission stays in
-- Medusa; these tables only power anonymous registrations for free events.

CREATE TABLE IF NOT EXISTS marketplace_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  medusa_seller_id TEXT        NOT NULL,
  slug             TEXT        NOT NULL UNIQUE,
  status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','cancelled')),
  title            TEXT        NOT NULL,
  description      TEXT,
  venue_name       TEXT        NOT NULL,
  venue_address    TEXT,
  starts_at        TIMESTAMPTZ NOT NULL,
  capacity         INTEGER     CHECK (capacity IS NULL OR capacity > 0),
  created_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_events_shop_idx
  ON marketplace_events (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_events_status_starts_idx
  ON marketplace_events (status, starts_at);

CREATE TABLE IF NOT EXISTS marketplace_event_registrations (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                   UUID        NOT NULL REFERENCES marketplace_events(id) ON DELETE CASCADE,
  name                       TEXT,
  email                      TEXT        NOT NULL,
  email_hash                 TEXT        NOT NULL,
  locale                     TEXT        NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  status                     TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','registered','cancelled')),
  verification_code_hash     TEXT,
  verification_expires_at    TIMESTAMPTZ,
  verification_attempts      INTEGER     NOT NULL DEFAULT 0,
  verification_sent_at       TIMESTAMPTZ,
  verified_at                TIMESTAMPTZ,
  confirmation_sent_at       TIMESTAMPTZ,
  metadata                   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, email_hash)
);

CREATE INDEX IF NOT EXISTS marketplace_event_registrations_event_idx
  ON marketplace_event_registrations (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_event_registrations_lookup_idx
  ON marketplace_event_registrations (event_id, email_hash);

DROP TRIGGER IF EXISTS marketplace_events_updated_at ON marketplace_events;
CREATE TRIGGER marketplace_events_updated_at
  BEFORE UPDATE ON marketplace_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS marketplace_event_registrations_updated_at ON marketplace_event_registrations;
CREATE TRIGGER marketplace_event_registrations_updated_at
  BEFORE UPDATE ON marketplace_event_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
