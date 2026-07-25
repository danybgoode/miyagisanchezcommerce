-- Merchant Partner lifecycle · Sprint 3 — additive, scoped to miyagisanchez
-- (shared Supabase). The builder does NOT apply this file — the ORCHESTRATOR
-- applies it by hand via the Supabase MCP `apply_migration` (the auto-mode
-- classifier blocks the `supabase db query` CLI path), then aligns
-- `schema_migrations`. A merged file is NOT an applied migration; verify with
-- to_regclass / information_schema per LEARNINGS "Supabase migration file vs.
-- actually-applied":
--
--   -- via the Supabase MCP:
--   apply_migration(name: 'partner_portfolio_s3', query: <this file>)
--   -- or, on the CLI path, in this order:
--   supabase db query --linked --file supabase/migrations/20260725120000_partner_portfolio_s3.sql
--   supabase migration repair --status applied 20260725120000 --linked
--
-- Never `supabase db push` in this repo — many local files are unrecorded
-- remotely, so a push would replay all of them.
--
-- What this adds, on top of Sprint 1+2 (…s1.sql, …s2.sql):
--
--   1. `merchant_relationship_tasks` gains `kind`, `outcome`, `dedupe_key` +
--      a PARTIAL unique constraint (Story 3.1) — the 30-day retention
--      check-in hangs off the write-once `first_sale` TRANSITION
--      (`merchant_relationship_transitions`, already `UNIQUE
--      (relationship_id, dedupe_key)` since Sprint 2 of the SIBLING
--      activation-ops epic), never off an order. A replayed/late/duplicated
--      sale fact cannot make a second task, because the transition it keys
--      off is itself write-once — no "repair" code path is needed.
--   2. `merchant_lifecycle_emissions` widens its PRIMARY KEY from
--      `(merchant_id, event_type)` to `(merchant_id, event_type,
--      dedupe_key)` (Story 3.3, README D8). THIS IS SAFE ONLY BECAUSE THE
--      TABLE HOLDS 0 ROWS IN PRODUCTION (verified live 2026-07-24, per the
--      README's baseline) — the schema fork is free exactly once, while the
--      table is empty, and it expires the moment a real event lands (the
--      same call activation-ops D1 made for a different table). Milestones
--      (the 14 `merchant.*` stage/preview events in
--      `lib/merchant-lifecycle.ts#MERCHANT_LIFECYCLE_EVENTS`) pass
--      `dedupe_key = ''` and keep BYTE-IDENTICAL write-once semantics — the
--      new column's `DEFAULT ''` means every existing INSERT/SELECT/UPDATE
--      call site that never mentions `dedupe_key` continues to address
--      exactly the one row it always addressed. Recurring portfolio events
--      (`lib/portfolio/events.ts#PORTFOLIO_LIFECYCLE_EVENTS` — its OWN
--      emit-only vocabulary, never appended to `MERCHANT_LIFECYCLE_EVENTS`,
--      which doubles as golden-beans' RETURN-LEG accept-list) pass a REAL
--      per-occurrence key instead, so a merchant going overdue five times
--      claims five distinct rows instead of colliding into one.
--   3. `merchant_portfolio_proposals` — the propose/confirm boundary for the
--      partner-agent surface (Story 3.2). A proposal is inert data until
--      `confirm_task_update` re-runs `resolveRelationshipAccess` +
--      `canWriteRelationship` against the CONFIRMING credential and applies
--      an explicit positive-list field set (task `title`/`due_at`/
--      `outcome`/`completed_at` + an optional interaction append) — it never
--      trusts the proposal's own scope, never touches
--      `steward_clerk_user_id`/`promoter_id`/`cohort`/`shop_id`, and never
--      sends anything.
--
-- OUTCOME VOCABULARY NOTE (build contract: "generate the CHECK's value list
-- from the same source ... and say explicitly the dictionary is
-- authoritative"): `lib/scorecard/dictionary.ts` had NO existing
-- retention/task-outcome vocabulary to import — verified 2026-07-25, grepped
-- the whole `lib/scorecard/` tree for "outcome" with zero hits. Flagged
-- deviation (not silently resolved): this sprint ADDS
-- `RETENTION_OUTCOMES = ['retained', 'at_risk', 'churned']` to that file
-- (the canonical home README D3 already names for "retention/outcome ...
-- vocabulary"), rather than inventing a second copy in `lib/portfolio/`. THE
-- DICTIONARY IS AUTHORITATIVE — this CHECK below is generated from it and
-- must be kept in lockstep by hand if that array ever changes; nothing in
-- `lib/portfolio/` or this file re-derives the list independently.
--
-- No new flag: both additions are reached through the SAME
-- `promoter.partner_portfolio_enabled` flag Sprint 1 already seeded (the
-- MCP route and the propose/confirm routes gate on it via
-- `resolvePartnerPortfolioActor` / `authorizePortfolioRequest`); the
-- retention-scheduling and portfolio-event sweep additions run unconditionally
-- inside the ALREADY-GATED `promoter.activation_crm_enabled` step of
-- `/api/cron/merchant-lifecycle-sweep` (same posture Sprint 2's reminder cron
-- already takes — it does not re-check `partner_portfolio_enabled` either).

-- ── 1. Retention task columns (Story 3.1) ───────────────────────────────────
ALTER TABLE merchant_relationship_tasks
  ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS outcome    TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

ALTER TABLE merchant_relationship_tasks
  DROP CONSTRAINT IF EXISTS merchant_relationship_tasks_kind_check;
ALTER TABLE merchant_relationship_tasks
  ADD CONSTRAINT merchant_relationship_tasks_kind_check
  CHECK (kind IN ('manual', 'retention_30d'));

-- Generated from lib/scorecard/dictionary.ts#RETENTION_OUTCOMES — THE
-- DICTIONARY IS AUTHORITATIVE (see the file header above). A NULL outcome
-- means "not yet recorded" (every pre-existing row, and every open task) —
-- never conflated with a real value.
ALTER TABLE merchant_relationship_tasks
  DROP CONSTRAINT IF EXISTS merchant_relationship_tasks_outcome_check;
ALTER TABLE merchant_relationship_tasks
  ADD CONSTRAINT merchant_relationship_tasks_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('retained', 'at_risk', 'churned'));

-- The idempotency guarantee ITSELF (build contract): a retention task's
-- `dedupe_key` is derived from the relationship id alone
-- (`lib/portfolio/retention.ts#retentionDedupeKey`), so a replayed/late
-- `first_sale` fact hits this constraint and inserts nothing the second
-- time — never a SELECT-then-INSERT. PARTIAL so the 0 existing rows (all
-- `dedupe_key IS NULL`, all `kind = 'manual'`) are never constrained by it.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_relationship_tasks_dedupe_uniq
  ON merchant_relationship_tasks (relationship_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ── 2. Widen the emission claim key (Story 3.3, README D8) ─────────────────
ALTER TABLE merchant_lifecycle_emissions
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT '';

ALTER TABLE merchant_lifecycle_emissions
  DROP CONSTRAINT IF EXISTS merchant_lifecycle_emissions_pkey;
ALTER TABLE merchant_lifecycle_emissions
  ADD PRIMARY KEY (merchant_id, event_type, dedupe_key);

-- ── 3. Partner-agent propose/confirm boundary (Story 3.2) ──────────────────
CREATE TABLE IF NOT EXISTS merchant_portfolio_proposals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  -- The synthetic partner actor id that PROPOSED it (`RelationshipActor
  -- .clerkUserId`, `partner:<promoter_id>` shape) — audit-only; never trusted
  -- as the confirming credential's own scope (`confirm_task_update` re-runs
  -- `resolveRelationshipAccess` against WHOEVER calls confirm, not this).
  proposed_by     TEXT        NOT NULL,
  -- `lib/portfolio/propose.ts#TaskUpdateProposal` — a positive-list shape
  -- (taskId?, title?, dueAt?, outcome?, completedAt?, interactionNote?).
  -- Never `steward_clerk_user_id`/`promoter_id`/`cohort`/`shop_id` — the
  -- confirm handler's writer only ever reads these six keys off this JSON,
  -- by name, never spreads it into an update.
  payload         JSONB       NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  confirmed_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_portfolio_proposals_relationship_idx
  ON merchant_portfolio_proposals (relationship_id, created_at DESC);

-- RLS: ON with NO policies, same posture as every other table in this family
-- — the app reaches Supabase exclusively through the service-role key, which
-- bypasses RLS, so enabling it costs nothing while removing anon/authenticated
-- access entirely under standard public-schema grants.
ALTER TABLE merchant_portfolio_proposals ENABLE ROW LEVEL SECURITY;
