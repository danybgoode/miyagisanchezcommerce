-- Order management + shipping infrastructure
-- 2026-05-26

-- ── 1. Extend marketplace_orders with shipping fields ─────────────────────────

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS buyer_clerk_user_id TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address    JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shipping_method     TEXT    NOT NULL DEFAULT 'none',
  -- none | free | flat | calculated | manual | pickup
  ADD COLUMN IF NOT EXISTS shipping_cost_cents INTEGER NOT NULL DEFAULT 0;

-- Order status extended lifecycle:
--   pending → paid → processing → shipped → in_transit → delivered → completed
--   (digital path: pending → paid → fulfilled)
--   (refunded at any point after paid)

CREATE INDEX IF NOT EXISTS marketplace_orders_buyer_clerk_idx
  ON marketplace_orders (buyer_clerk_user_id)
  WHERE buyer_clerk_user_id IS NOT NULL;

-- ── 2. marketplace_shipments ──────────────────────────────────────────────────
-- One row per shipment. An order can have one active shipment (re-ship is rare
-- but supported via a new row + old one marked cancelled).

CREATE TABLE IF NOT EXISTS marketplace_shipments (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID        NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,

  -- Carrier identity
  carrier                 TEXT        NOT NULL,
  -- 'dhl' | 'fedex' | 'estafeta' | 'ups' | 'redpack' | 'paquetexpress' | 'manual'
  tracking_number         TEXT,
  label_url               TEXT,        -- PDF/ZPL label URL from Envia (or null for manual)

  -- Envia-specific IDs (null for manual shipments)
  envia_shipment_id       TEXT        UNIQUE,
  envia_rate_id           TEXT,        -- Rate ID selected from the quote

  -- Tracking lifecycle
  status                  TEXT        NOT NULL DEFAULT 'label_created',
  -- label_created | picked_up | in_transit | out_for_delivery | delivered | exception | cancelled

  estimated_delivery_date DATE,
  weight_grams            INTEGER,

  metadata                JSONB       NOT NULL DEFAULT '{}',
  -- Stores full Envia API responses, carrier events, etc.

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_shipments_order_id_idx
  ON marketplace_shipments (order_id);

CREATE INDEX IF NOT EXISTS marketplace_shipments_status_idx
  ON marketplace_shipments (status);

CREATE INDEX IF NOT EXISTS marketplace_shipments_tracking_idx
  ON marketplace_shipments (tracking_number)
  WHERE tracking_number IS NOT NULL;

-- Reuse the update_updated_at() function created in 20260520_marketplace_orders.sql
DROP TRIGGER IF EXISTS marketplace_shipments_updated_at ON marketplace_shipments;
CREATE TRIGGER marketplace_shipments_updated_at
  BEFORE UPDATE ON marketplace_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
