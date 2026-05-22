-- Sprint 2: Subscriptions Phase A
-- marketplace_subscriptions: buyer subscription records
-- marketplace_subscription_content: seller-gated content posts

-- ── Subscriptions ─────────────────────────────────────────────────────────────
CREATE TABLE marketplace_subscriptions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID        NOT NULL REFERENCES marketplace_listings(id),
  shop_id               UUID        NOT NULL REFERENCES marketplace_shops(id),

  -- Buyer identity
  buyer_clerk_user_id   TEXT,
  buyer_email           TEXT        NOT NULL,
  buyer_name            TEXT,

  -- Stripe (nullable for SPEI)
  stripe_subscription_id TEXT       UNIQUE,
  stripe_customer_id    TEXT,

  -- Payment method
  payment_method        TEXT        NOT NULL DEFAULT 'stripe', -- 'stripe' | 'spei'

  -- Status: active | canceled | past_due | pending_confirmation | trialing
  status                TEXT        NOT NULL DEFAULT 'active',

  -- Billing period (updated on each successful invoice)
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN     NOT NULL DEFAULT false,

  -- Flexible extra data (SPEI confirmation notes, etc.)
  metadata              JSONB       NOT NULL DEFAULT '{}',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_subscriptions_listing_id_idx   ON marketplace_subscriptions(listing_id);
CREATE INDEX marketplace_subscriptions_shop_id_idx       ON marketplace_subscriptions(shop_id);
CREATE INDEX marketplace_subscriptions_buyer_clerk_idx   ON marketplace_subscriptions(buyer_clerk_user_id)
  WHERE buyer_clerk_user_id IS NOT NULL;
CREATE INDEX marketplace_subscriptions_status_idx        ON marketplace_subscriptions(status);
CREATE INDEX marketplace_subscriptions_stripe_sub_idx    ON marketplace_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ── Subscription content ──────────────────────────────────────────────────────
CREATE TABLE marketplace_subscription_content (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID        NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  -- null = visible to all active subscribers of the shop
  -- set to a specific listing_id to restrict to subscribers of that plan
  listing_id    UUID        REFERENCES marketplace_listings(id) ON DELETE SET NULL,

  title         TEXT        NOT NULL,
  body          TEXT,                         -- markdown / plain text
  file_url      TEXT,                         -- R2/Supabase public URL
  file_type     TEXT,                         -- 'image' | 'video' | 'document' | 'audio'

  is_published  BOOLEAN     NOT NULL DEFAULT true,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_subscription_content_shop_id_idx     ON marketplace_subscription_content(shop_id);
CREATE INDEX marketplace_subscription_content_listing_id_idx  ON marketplace_subscription_content(listing_id)
  WHERE listing_id IS NOT NULL;
CREATE INDEX marketplace_subscription_content_published_idx   ON marketplace_subscription_content(shop_id, is_published, created_at DESC);
