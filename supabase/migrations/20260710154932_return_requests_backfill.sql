-- ── Return requests — backfill (09-platform-infra frontend-vercel-to-cloudrun, Sprint 3.1) ──
-- The 20260526100000_return_requests migration is recorded as applied in Supabase's migration
-- history, but its DDL never actually landed in production: neither marketplace_return_requests
-- nor marketplace_orders.return_requested_at existed (confirmed via information_schema query,
-- 2026-07-10) -- discovered because order-autoconfirm's cron 500s on the missing column. Likely
-- cause: the original migration file was edited after being marked applied, so the tracker
-- skipped re-running it. This re-applies the exact same DDL from that file, verbatim, all
-- IF NOT EXISTS / idempotent, so it's safe even if parts of it did partially land elsewhere.
-- Applied live to production 2026-07-10 via the Supabase MCP (name: return_requests_backfill).

CREATE TABLE IF NOT EXISTS marketplace_return_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID        NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  shop_id              UUID        NOT NULL REFERENCES marketplace_shops(id)  ON DELETE CASCADE,
  buyer_clerk_user_id  TEXT,
  buyer_email          TEXT,

  reason               TEXT        NOT NULL CHECK (reason IN (
    'not_as_described',
    'damaged',
    'wrong_item',
    'changed_mind',
    'other'
  )),
  description          TEXT,

  status               TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'accepted',
    'partial_refund',
    'declined',
    'refunded'
  )),
  refund_amount_cents  INTEGER,
  seller_note          TEXT,
  stripe_refund_id     TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mrr_order_id   ON marketplace_return_requests(order_id);
CREATE INDEX IF NOT EXISTS mrr_shop_id    ON marketplace_return_requests(shop_id);
CREATE INDEX IF NOT EXISTS mrr_buyer_email ON marketplace_return_requests(buyer_email);

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_return_requests'
  ) THEN
    CREATE TRIGGER set_updated_at_return_requests
      BEFORE UPDATE ON marketplace_return_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
