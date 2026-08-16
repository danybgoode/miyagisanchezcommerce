-- Explicit guard modes for the metadata merge (golden-frijoles-integration · S3.1).
--
-- HOW THIS GETS APPLIED: applied to production 2026-08-14 via the Supabase MCP
-- `apply_migration` (the orchestrator applies migrations, never a builder — AGENTS
-- rule 6). Filename matches the version the MCP recorded. Never `supabase db push`.
--
-- Supersedes 20260814225509, which inferred the guard from whether `p_expected` was
-- SQL NULL. That made two different states indistinguishable:
--   · the key is ABSENT                       → `metadata -> key` is SQL NULL
--   · the key is PRESENT holding JSON `null`  → `metadata -> key` is jsonb 'null'
-- A JS caller cannot express the second, because supabase-js sends JS null as SQL
-- NULL. So a key holding JSON null was classified ABSENT by the TypeScript planner
-- and PRESENT by SQL's `?` operator; the merge matched zero rows, verification found
-- no valid grant, and every retry failed — a permanently stuck shop.
--
-- The mode is now STATED, never inferred:
--   'none'       → merge unconditionally
--   'absent'     → merge only while the key is absent       (not (metadata ? key))
--   'json_null'  → merge only while the key holds JSON null (metadata -> key = 'null')
--   'equals'     → merge only while the key equals p_expected (compare-and-swap)
--
-- An unrecognised mode merges NOTHING. A guard nobody understands must not fall
-- through to an unconditional write.
--
-- Still NO grant-validity logic here. Whether a shop is owed a grant is decided in
-- TypeScript (`lib/paywall-grandfather.ts`); a second copy of that rule in SQL is the
-- paraphrased contract that drifts permissive. This compares values, it does not
-- judge them.
drop function if exists public.merge_shop_metadata(uuid, jsonb, text, jsonb);

create or replace function public.merge_shop_metadata(
  p_shop_id uuid,
  p_patch jsonb,
  p_guard_key text default null,
  p_guard_mode text default 'none',
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
    and case
      when p_guard_key is null or p_guard_mode = 'none' then true
      when p_guard_mode = 'absent'    then not (coalesce(s.metadata, '{}'::jsonb) ? p_guard_key)
      when p_guard_mode = 'json_null' then (coalesce(s.metadata, '{}'::jsonb) -> p_guard_key) = 'null'::jsonb
      when p_guard_mode = 'equals'    then (coalesce(s.metadata, '{}'::jsonb) -> p_guard_key) is not distinct from p_expected
      else false
    end
  returning s.id, s.metadata;
$$;

-- service_role only. This merges arbitrary keys into a shop's metadata, so no
-- request-bearing role may reach it.
revoke all on function public.merge_shop_metadata(uuid, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.merge_shop_metadata(uuid, jsonb, text, text, jsonb) to service_role;
