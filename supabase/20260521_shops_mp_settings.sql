-- MercadoPago per-seller settings on marketplace_shops.
-- mp_enabled: sellers can disable MP checkout for their shop.
-- mp_seller_token: encrypted access token for future MP Marketplace OAuth flow.

ALTER TABLE marketplace_shops
  ADD COLUMN IF NOT EXISTS mp_enabled      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mp_seller_token TEXT;   -- AES-256-GCM encrypted, set when seller connects their own MP account
