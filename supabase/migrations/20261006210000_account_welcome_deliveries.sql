-- A verified Clerk account receives the welcome once, even when Clerk retries
-- user.created/user.updated webhooks or two deliveries arrive concurrently.
CREATE TABLE IF NOT EXISTS public.account_welcome_deliveries (
  clerk_user_id text PRIMARY KEY,
  email text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent')),
  claimed_at timestamptz,
  provider_email_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.account_welcome_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_welcome_deliveries FROM anon, authenticated;

-- Only accounts created after the webhook is installed get a row. Updates to
-- older Clerk users cannot silently backfill them into a new-user welcome.
CREATE OR REPLACE FUNCTION public.claim_account_welcome(p_user_id text, p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed boolean := false;
BEGIN
  UPDATE public.account_welcome_deliveries
    SET email = p_email, state = 'sending', claimed_at = now()
    WHERE clerk_user_id = p_user_id AND (
      state = 'pending' OR (state = 'sending' AND claimed_at < now() - interval '10 minutes')
    )
    RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END $$;
REVOKE ALL ON FUNCTION public.claim_account_welcome(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_account_welcome(text, text) TO service_role;
