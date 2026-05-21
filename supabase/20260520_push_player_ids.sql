-- Reserve push notification player ID columns for Capacitor (task #20).
-- No logic attached yet — registration endpoint will write here when the app is built.

ALTER TABLE marketplace_shops
  ADD COLUMN IF NOT EXISTS push_player_id TEXT;

ALTER TABLE marketplace_offers
  ADD COLUMN IF NOT EXISTS buyer_push_player_id TEXT;
