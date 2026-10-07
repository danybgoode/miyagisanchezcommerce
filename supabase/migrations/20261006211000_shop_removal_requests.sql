-- Non-commerce audit for a public takedown request. Medusa remains the sole
-- source of seller status; this records who asked and what action was observed.
CREATE TABLE IF NOT EXISTS public.shop_removal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.marketplace_shops(id),
  requested_email text NOT NULL,
  reason text NOT NULL,
  market_code text NOT NULL CHECK (market_code IN ('mx', 'us')),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'paused', 'status_unknown', 'verified', 'rejected', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  verification_note text,
  verified_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS shop_removal_requests_open_idx
  ON public.shop_removal_requests(shop_id, created_at DESC)
  WHERE state IN ('received', 'paused', 'status_unknown');
ALTER TABLE public.shop_removal_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_removal_requests FROM anon, authenticated;
