-- Compare-and-swap for the metadata merge (golden-frijoles-integration · S3.1).
--
-- HOW THIS GETS APPLIED: applied to production 2026-08-14 via the Supabase MCP
-- `apply_migration` (the orchestrator applies migrations, never a builder — AGENTS
-- rule 6). This file is the tracked record of what ran. Never `supabase db push`.
--
-- Supersedes 20260814225057, which could guard only on a key being ABSENT. That left
-- the REPAIR path — a present-but-malformed grant, which `readGrant` refuses so it
-- entitles nobody — merging unconditionally, so a valid grant added concurrently
-- could be replaced with a grandfather one.
--
-- One guard concept now covers both cases:
--   p_guard_key NULL                     → merge unconditionally
--   p_guard_key set, p_expected NULL     → merge only while that key is ABSENT
--   p_guard_key set, p_expected non-NULL → merge only while that key EQUALS
--                                          p_expected (compare-and-swap: repair the
--                                          exact malformed value we read, or refuse)
--
-- Still NO grant-validity logic here. Whether a shop is owed a grant is decided in
-- TypeScript (`lib/paywall-grandfather.ts`); a second copy of that rule in SQL is the
-- paraphrased contract that drifts permissive, which this repo has been bitten by
-- five times. This function compares values, it does not judge them.
--
-- `is not distinct from` rather than `=` so a NULL on either side compares correctly
-- instead of yielding NULL and silently failing the WHERE clause.
drop function if exists public.merge_shop_metadata(uuid, jsonb, text);

create or replace function public.merge_shop_metadata(
  p_shop_id uuid,
  p_patch jsonb,
  p_guard_key text default null,
  p_expected jsonb default null
)
returns table (id uuid, metadata jsonb)
language sql
security definer
set search_path = public
as $$
  update marketplace_shops s
  set metadata = coalesce(s.metadata, '{}'::jsonb) || p_patch
  where s.id = p_shop_id
    and (
      p_guard_key is null
      or (
        p_expected is null
          and not (coalesce(s.metadata, '{}'::jsonb) ? p_guard_key)
      )
      or (
        p_expected is not null
          and (coalesce(s.metadata, '{}'::jsonb) -> p_guard_key) is not distinct from p_expected
      )
    )
  returning s.id, s.metadata;
$$;

-- service_role only. This merges arbitrary keys into a shop's metadata, so no
-- request-bearing role may reach it.
revoke all on function public.merge_shop_metadata(uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.merge_shop_metadata(uuid, jsonb, text, jsonb) to service_role;
