-- ── Favorites ────────────────────────────────────────────────────────────────
-- Tracks items a buyer has saved. price_cents_at_save enables price-drop alerts.

CREATE TABLE marketplace_favorites (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id  TEXT        NOT NULL,
  listing_id     UUID        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  price_cents_at_save INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(clerk_user_id, listing_id)
);

CREATE INDEX idx_favorites_user    ON marketplace_favorites(clerk_user_id);
CREATE INDEX idx_favorites_listing ON marketplace_favorites(listing_id);

-- ── Conversations ─────────────────────────────────────────────────────────────
-- One conversation per (buyer, listing) pair. Always tied to the active offer.
-- Serves as the persistent thread for haggling, order tracking, and agent access.

CREATE TABLE marketplace_conversations (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id            UUID        NOT NULL REFERENCES marketplace_listings(id),
  shop_id               UUID        NOT NULL REFERENCES marketplace_shops(id),
  buyer_clerk_user_id   TEXT        NOT NULL,
  seller_clerk_user_id  TEXT        NOT NULL,
  offer_id              UUID        REFERENCES marketplace_offers(id),
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','cancelled','archived')),
  last_event_at         TIMESTAMPTZ DEFAULT NOW(),
  buyer_unread          INTEGER     NOT NULL DEFAULT 0,
  seller_unread         INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(buyer_clerk_user_id, listing_id)
);

CREATE INDEX idx_conversations_buyer  ON marketplace_conversations(buyer_clerk_user_id);
CREATE INDEX idx_conversations_seller ON marketplace_conversations(seller_clerk_user_id);
CREATE INDEX idx_conversations_shop   ON marketplace_conversations(shop_id);
CREATE INDEX idx_conversations_offer  ON marketplace_conversations(offer_id);

-- ── Conversation events ────────────────────────────────────────────────────────
-- Immutable log of everything that happened in a conversation.
-- event_type mirrors the offer state machine + lifecycle + stamps.
-- metadata carries type-specific payload (amounts, stamp keys, tracking numbers).

CREATE TABLE marketplace_conversation_events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID        NOT NULL REFERENCES marketplace_conversations(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN (
    'offer_sent', 'offer_countered', 'offer_accepted', 'offer_declined',
    'offer_withdrawn', 'offer_expired',
    'purchase_complete', 'shipped', 'delivered', 'feedback_left',
    'stamp_sent'
  )),
  actor           TEXT        NOT NULL CHECK (actor IN (
    'buyer', 'seller', 'system', 'buyer_agent', 'seller_agent'
  )),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_conv_events_conv ON marketplace_conversation_events(conversation_id);
CREATE INDEX idx_conv_events_type ON marketplace_conversation_events(event_type);
