-- ── Print Edition (Phase 1) ───────────────────────────────────────────────────
-- Non-commerce editorial/creative layer for the "Sal en la edición impresa" feature.
-- All ACTUAL commerce stays in Medusa: the sellable placement is a Medusa product,
-- the purchase is a Medusa cart→order→payment. These tables hold only what Medusa
-- has no concept of — print suppliers, magazine issues, and ad-creative submissions —
-- exactly like marketplace_offers / marketplace_conversations (AGENTS rule #2).
--
-- Links to Medusa are plain text columns (seller_id, medusa_product_id,
-- medusa_order_id, cart_id) — there are no FKs into Medusa's Postgres.

-- ── Providers ─────────────────────────────────────────────────────────────────
-- Local print shops we submit finished files to. miyagiprints (the owner's own
-- shop) is seeded as the default. A provider is a SUPPLIER, not a marketplace seller.
CREATE TABLE IF NOT EXISTS print_providers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  description         TEXT,
  is_default          BOOLEAN     NOT NULL DEFAULT false,
  active              BOOLEAN     NOT NULL DEFAULT true,
  location            TEXT,
  -- Array of zone strings the provider distributes in (e.g. ["Roma","Condesa"])
  coverage_zones      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  distribution_notes  TEXT,
  schedule_notes      TEXT,
  -- Image of a past edition shown to sellers as a preview
  preview_url         TEXT,
  -- Print-file requirements: { trim_size, bleed_mm, dpi, color_mode, pdf_standard, fonts, ink_limit }
  file_spec           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Editions ──────────────────────────────────────────────────────────────────
-- A dated issue printed by a provider. tiers[] holds the ad sizes on offer, each
-- mapped to a Medusa placement product created when the edition is saved.
CREATE TABLE IF NOT EXISTS print_editions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID        NOT NULL REFERENCES print_providers(id) ON DELETE RESTRICT,
  title               TEXT        NOT NULL,
  -- draft → open (accepting buys) → closed (deadline passed) → in_production → distributed
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','open','closed','in_production','distributed')),
  submission_deadline TIMESTAMPTZ,
  distribution_date   DATE,
  coverage_zones      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Array of { key:'full'|'half'|'quarter'|'card', label, price_cents, capacity, medusa_product_id }
  tiers               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_editions_provider_idx ON print_editions (provider_id);
CREATE INDEX IF NOT EXISTS print_editions_status_idx   ON print_editions (status);

-- ── Ad submissions ──────────────────────────────────────────────────────────────
-- The buyer's ad ingredients + workflow state, linked to a Medusa order once paid.
CREATE TABLE IF NOT EXISTS print_ad_submissions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id          UUID        NOT NULL REFERENCES print_editions(id) ON DELETE CASCADE,
  tier_key            TEXT        NOT NULL,
  -- The advertiser's Medusa seller id (the buying tenant's shop)
  seller_id           TEXT        NOT NULL,
  buyer_clerk_user_id TEXT,
  buyer_email         TEXT,
  -- Medusa correlation: cart_id is stamped when checkout starts; the webhook looks
  -- the submission up by cart_id and fills medusa_order_id on payment.
  cart_id             TEXT,
  medusa_order_id     TEXT,
  medusa_product_id   TEXT,
  -- draft → pending_payment → paid → approved → placed | rejected | refunded
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_payment','paid','approved','placed','rejected','refunded')),
  -- Ad ingredients: { headline, subhead, body, logo_url, photos[], contact{}, cta_target{},
  --                   featured_listing_ids[], template_choice }
  content             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  admin_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_ad_submissions_edition_idx ON print_ad_submissions (edition_id);
CREATE INDEX IF NOT EXISTS print_ad_submissions_seller_idx  ON print_ad_submissions (seller_id);
CREATE INDEX IF NOT EXISTS print_ad_submissions_cart_idx    ON print_ad_submissions (cart_id);
CREATE INDEX IF NOT EXISTS print_ad_submissions_status_idx  ON print_ad_submissions (status);
CREATE INDEX IF NOT EXISTS print_ad_submissions_clerk_idx   ON print_ad_submissions (buyer_clerk_user_id);

-- ── updated_at triggers (reuses update_updated_at() from marketplace_orders) ────
DROP TRIGGER IF EXISTS print_providers_updated_at ON print_providers;
CREATE TRIGGER print_providers_updated_at
  BEFORE UPDATE ON print_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS print_editions_updated_at ON print_editions;
CREATE TRIGGER print_editions_updated_at
  BEFORE UPDATE ON print_editions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS print_ad_submissions_updated_at ON print_ad_submissions;
CREATE TRIGGER print_ad_submissions_updated_at
  BEFORE UPDATE ON print_ad_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Seed: miyagiprints (the owner's own print shop) ─────────────────────────────
INSERT INTO print_providers (slug, name, description, is_default, location, file_spec)
VALUES (
  'miyagiprints',
  'Miyagi Prints',
  'Imprenta propia de Miyagi Sánchez. Diseño y publicación de anuncios en la edición impresa local.',
  true,
  'Ciudad de México',
  jsonb_build_object(
    'trim_size',    'Carta (8.5 x 11 in)',
    'bleed_mm',     3,
    'dpi',          300,
    'color_mode',   'CMYK',
    'pdf_standard', 'PDF/X-1a:2001',
    'fonts',        'embedded',
    'ink_limit',    300
  )
)
ON CONFLICT (slug) DO NOTHING;
