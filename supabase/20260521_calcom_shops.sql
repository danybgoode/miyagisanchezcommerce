-- Cal.com scheduling integration
-- calcom_api_key lives as a proper column (not JSONB) so it's never leaked to the client
ALTER TABLE marketplace_shops
  ADD COLUMN IF NOT EXISTS calcom_api_key TEXT;  -- Cal.com API key (sensitive, never returned to client)
