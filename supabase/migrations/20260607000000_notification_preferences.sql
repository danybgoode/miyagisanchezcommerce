-- Granular Multi-Channel Notifications · Sprint 1 — per-user, non-commerce data.
-- Additive, scoped to miyagisanchez (shared Supabase). Keyed by clerk_user_id,
-- mirrors push_subscriptions (db/messaging-realtime.sql): server-only access —
-- RLS ON with no authenticated policies, so only the service role reads/writes.
-- Run via Supabase CLI / SQL editor:
--   https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

-- ── Notification preferences ──────────────────────────────────────────────────
-- Sparse store: only explicit toggles are persisted. An absent (group, channel)
-- row resolves to ENABLED in app code (DEFAULT_PREFS) → no backfill needed for
-- the 164 existing sellers, and the default experience stays unchanged.
--   channel:     'email' | 'push' | 'telegram'
--   event_group: 'orders' | 'offers' | 'payments' | 'returns'
CREATE TABLE IF NOT EXISTS notification_preferences (
  clerk_user_id  TEXT        NOT NULL,
  channel        TEXT        NOT NULL,
  event_group    TEXT        NOT NULL,
  enabled        BOOLEAN     NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clerk_user_id, channel, event_group)
);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences (clerk_user_id);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- ── Telegram link (Sprint 2 lights it up; table ships now) ────────────────────
-- One linked Telegram chat per seller. chat_id captured by the Sprint-2 webhook.
CREATE TABLE IF NOT EXISTS telegram_links (
  clerk_user_id  TEXT        PRIMARY KEY,
  chat_id        TEXT        NOT NULL,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE telegram_links ENABLE ROW LEVEL SECURITY;
