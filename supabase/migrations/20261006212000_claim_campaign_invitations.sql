-- Operator-vetted campaign links. Store the source of each contact and the
-- conversion state, but never the signed link or JWT itself.
CREATE TABLE IF NOT EXISTS public.claim_campaign_invitations (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL,
  shop_slug text NOT NULL,
  contact_email text NOT NULL,
  contact_provenance text NOT NULL,
  market_code text NOT NULL CHECK (market_code IN ('mx', 'us')),
  campaign_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  removal_requested_at timestamptz
);
CREATE INDEX IF NOT EXISTS claim_campaign_invitations_campaign_idx
  ON public.claim_campaign_invitations(campaign_id, created_at DESC);
ALTER TABLE public.claim_campaign_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.claim_campaign_invitations FROM anon, authenticated;
