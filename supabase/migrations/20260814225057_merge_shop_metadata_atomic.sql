-- Atomic JSONB merge for shop metadata (golden-frijoles-integration · S3.1).
--
-- HOW THIS GETS APPLIED: applied to production 2026-08-14 via the Supabase MCP
-- `apply_migration` (the orchestrator applies migrations, never a builder — AGENTS
-- rule 6). `supabase_migrations.schema_migrations` already carries version
-- 20260814225057 under this name, so this file is the tracked record of what ran,
-- not a pending change. Never `supabase db push`.
--
-- WHY: the paywall grandfather backfill read a shop's metadata, added a grant key,
-- and wrote the WHOLE object back. Any unrelated key another writer changed in
-- between (settings, theme, a domain) was silently reverted. Read-modify-write on a
-- shared JSONB column is the bug; a server-side merge is the fix.
--
-- This function deliberately contains NO grant-validity logic. Deciding whether a
-- shop is owed a grant stays in TypeScript (`lib/paywall-grandfather.ts`), because a
-- second copy of that rule expressed in SQL is exactly the paraphrased contract that
-- drifts permissive — this repo has been bitten by that five times. All this does is
-- merge the keys it is handed, atomically, and optionally refuse when a key already
-- exists.
--
-- `p_require_absent_key`:
--   NULL  — merge unconditionally (used to REPAIR a malformed grant, which is
--           present but entitles nobody, so an "is absent" guard would reject it).
--   text  — merge only while that key is absent, so a grant added concurrently is
--           never overwritten. PRESENCE, not validity — see above.
--
-- Returns the updated row, or no rows when the guard refused. A caller that gets no
-- row knows the guard fired; it must not read that as success.
create or replace function public.merge_shop_metadata(
  p_shop_id uuid,
  p_patch jsonb,
  p_require_absent_key text default null
)
returns table (id uuid, metadata jsonb)
language sql
security definer
set search_path = public
as $$
  update marketplace_shops s
  set metadata = coalesce(s.metadata, '{}'::jsonb) || p_patch
  where s.id = p_shop_id
    and (p_require_absent_key is null or not (coalesce(s.metadata, '{}'::jsonb) ? p_require_absent_key))
  returning s.id, s.metadata;
$$;

-- service_role only. This merges arbitrary keys into a shop's metadata, so no
-- request-bearing role may reach it.
revoke all on function public.merge_shop_metadata(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.merge_shop_metadata(uuid, jsonb, text) to service_role;
