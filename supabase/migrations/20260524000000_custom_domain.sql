-- Federated commerce: custom domain per shop (own channel)
--
-- Allows sellers to serve their storefront from their own domain
-- (e.g. myshop.mx → cname.vercel-dns.com → /s/[slug])
-- while keeping their miyagisanchez.com listing as a separate channel.

ALTER TABLE marketplace_shops
  ADD COLUMN IF NOT EXISTS custom_domain            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS custom_domain_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_domain_vercel_ok  BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce uniqueness so two shops can't claim the same domain
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_shops_custom_domain_unique
  ON marketplace_shops (custom_domain)
  WHERE custom_domain IS NOT NULL;
