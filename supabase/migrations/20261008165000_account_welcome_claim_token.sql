-- A timed-out email request can overlap a replacement sender. Only the
-- reservation holder may release or complete its own delivery.
ALTER TABLE public.account_welcome_deliveries
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE OR REPLACE FUNCTION public.reserve_account_welcome(p_user_id text, p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token uuid;
BEGIN
  UPDATE public.account_welcome_deliveries
    SET email = p_email, state = 'sending', claimed_at = now(), claim_token = gen_random_uuid()
    WHERE clerk_user_id = p_user_id AND (
      state = 'pending' OR (state = 'sending' AND claimed_at < now() - interval '10 minutes')
    )
    RETURNING claim_token INTO token;
  RETURN token;
END $$;
REVOKE ALL ON FUNCTION public.reserve_account_welcome(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_account_welcome(text, text) TO service_role;
