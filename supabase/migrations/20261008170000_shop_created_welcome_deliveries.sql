-- Only a newly created seller gets a row. Existing sellers without one predate
-- this welcome and must not receive it on their next visit.
CREATE TABLE IF NOT EXISTS public.shop_created_welcome_deliveries (
  seller_id text PRIMARY KEY,
  owner_clerk_id text NOT NULL,
  shop_name text NOT NULL,
  shop_slug text NOT NULL,
  market text NOT NULL CHECK (market IN ('mx', 'us')),
  email text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent')),
  claimed_at timestamptz,
  claim_token uuid,
  provider_email_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.shop_created_welcome_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_created_welcome_deliveries FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_shop_created_welcome(p_seller_id text, p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token uuid;
BEGIN
  UPDATE public.shop_created_welcome_deliveries
    SET email = p_email, state = 'sending', claimed_at = now(), claim_token = gen_random_uuid()
    WHERE seller_id = p_seller_id AND (
      state = 'pending' OR (state = 'sending' AND claimed_at < now() - interval '10 minutes')
    )
    RETURNING claim_token INTO token;
  RETURN token;
END $$;
REVOKE ALL ON FUNCTION public.reserve_shop_created_welcome(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_shop_created_welcome(text, text) TO service_role;
