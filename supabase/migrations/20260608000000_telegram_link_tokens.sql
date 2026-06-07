-- Granular Multi-Channel Notifications · Sprint 2 — Telegram linking tokens.
-- Additive, scoped to miyagisanchez (shared Supabase). Server-only access:
-- RLS ON with no authenticated policies, so only the service role reads/writes
-- (mirrors notification_preferences / telegram_links from Sprint 1).
-- Run via Supabase CLI / SQL editor:
--   https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor

-- ── Telegram link tokens (single-use, short-TTL) ──────────────────────────────
-- The "Conecta Telegram" flow mints a token, embeds it in a t.me deep link, and
-- the bot webhook redeems it to bind the seller's chat_id. Single-use is enforced
-- by DELETEing the row on redemption; expiry is enforced in app code against
-- expires_at (a cleanup of stale rows is optional — they are inert once expired).
--   token:         the ?start= payload (url-safe, <= 64 chars per Telegram rules)
--   clerk_user_id: the seller who initiated the link
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token          TEXT        PRIMARY KEY,
  clerk_user_id  TEXT        NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user
  ON telegram_link_tokens (clerk_user_id);
ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;
