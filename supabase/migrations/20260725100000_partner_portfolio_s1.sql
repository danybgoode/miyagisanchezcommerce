-- Merchant Partner lifecycle · Sprint 1 — additive, scoped to miyagisanchez
-- (shared Supabase). The builder does NOT apply this file — the ORCHESTRATOR
-- applies it by hand via the Supabase MCP `apply_migration` (the auto-mode
-- classifier blocks the `supabase db query` CLI path), then aligns
-- `schema_migrations`. A merged file is NOT an applied migration; verify with
-- to_regclass / information_schema per LEARNINGS "Supabase migration file vs.
-- actually-applied":
--
--   -- via the Supabase MCP:
--   apply_migration(name: 'partner_portfolio_s1', query: <this file>)
--   -- or, on the CLI path, in this order:
--   supabase db query --linked --file supabase/migrations/20260725100000_partner_portfolio_s1.sql
--   supabase migration repair --status applied 20260725100000 --linked
--
-- Never `supabase db push` in this repo — many local files are unrecorded
-- remotely, so a push would replay all of them.
--
-- What this adds, on top of the founding-merchant-activation-ops canonical
-- record (20260723100000_activation_crm_s1.sql / _s2.sql):
--
--   1. Five NULLABLE stewardship/SLA columns on `merchant_relationships`
--      (README D1 — the portfolio is a READ MODEL over activation-ops, so the
--      only new canonical state is the stewardship artifact that has nowhere
--      else to live). All nullable: the 29 live rows stay valid with NO
--      backfill, and an absent `sla_policy_version` means "this row has never
--      been evaluated against a stored policy", never "version 0".
--   2. `merchant_sla_policy` — the single active, versioned response-window
--      policy (README D3). Seeded with NOTHING: absence means "use the code
--      default" (`lib/portfolio/sla.ts#DEFAULT_SLA_POLICY`), which is the
--      authoritative fallback. Single-row-ness is a CHECK constraint, not a
--      convention — see the table.
--   3. Three additive columns on `merchant_relationship_owner_history`
--      (Story 1.3) so a privileged reassignment records WHY, WHEN it takes
--      effect, and how many open tasks moved with it.
--   4. The dark-launch enablement flag `promoter.partner_portfolio_enabled`
--      (born OFF, everywhere).
--
-- VOCABULARY NOTE (cited, never restated): this file deliberately defines NO
-- stage list, NO overdue rule, NO response-window threshold and NO outcome
-- vocabulary. Those live in `lib/merchant-stage.ts#STAGES`,
-- `lib/relationship-pipeline.ts`, `lib/portfolio/sla.ts` and
-- `lib/scorecard/dictionary.ts` respectively, and a CHECK constraint here that
-- paraphrased any of them would fork it (LEARNINGS: "a paraphrased contract
-- drifts permissive" — that defect bit four times in the sibling
-- activation-ops epic). The only CHECK below is the single-row guard on
-- `merchant_sla_policy`, which restates nothing.

-- ── 1. Stewardship / SLA state on the canonical relationship row ────────────
ALTER TABLE merchant_relationships
  -- WHY the current steward holds this merchant (Story 1.1 acceptance:
  -- "assignment reason"). Free text, set by the reassignment routes.
  ADD COLUMN IF NOT EXISTS assignment_reason        TEXT,
  -- WHEN the current stewardship took effect. Distinct from `updated_at`
  -- (which any edit bumps) and from `created_at`.
  ADD COLUMN IF NOT EXISTS assigned_at              TIMESTAMPTZ,
  -- The response deadline the SLA layer most recently resolved for this row.
  -- A DERIVED value, mirrored here only so a future notification/cron path can
  -- query it in SQL; `lib/portfolio/sla.ts#resolveSlaState` is authoritative
  -- and recomputes it on every read (the read model never trusts this column).
  ADD COLUMN IF NOT EXISTS response_due_at          TIMESTAMPTZ,
  -- Per-relationship escalation override. NULL ⇒ fall back to the policy's own
  -- escalation target (`lib/portfolio/sla.ts`).
  ADD COLUMN IF NOT EXISTS escalation_clerk_user_id TEXT,
  -- Which `merchant_sla_policy.version` last evaluated this row. NULL ⇒ never
  -- evaluated against a stored policy (the code default applied).
  ADD COLUMN IF NOT EXISTS sla_policy_version       INT;

-- ── 2. The single active, versioned response-window policy (README D3) ──────
-- Admin-writable (`PUT /api/admin/sla-policy`), read by
-- `lib/portfolio/policy-server.ts`. Deliberately NOT a CRUD product: exactly
-- one row ever exists, `version` bumps on every write, and the CODE default is
-- the authoritative fallback whenever the row is absent OR unreadable.
--
-- `id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1)` is the single-row guarantee BY
-- CONSTRAINT, not by writer discipline — the same posture
-- `merchant_relationship_transitions`'s UNIQUE dedupe key takes toward replay.
-- A second row is impossible, so "the single active row" can never quietly
-- become "whichever row the reader happened to pick first".
CREATE TABLE IF NOT EXISTS merchant_sla_policy (
  id          INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Monotonic policy version. Bumped by the admin PUT on every write, echoed
  -- into every portfolio row's `slaPolicyVersion` so a rendered queue can
  -- always name the policy it was computed under.
  version     INT         NOT NULL,

  -- The policy itself: per-stage response/stall windows + the escalation
  -- target. Validated on READ by `lib/portfolio/sla.ts#parseSlaPolicy`, which
  -- fails CLOSED to the code default on any malformed shape — deliberately NOT
  -- constrained by a JSONB CHECK here, because a CHECK would have to restate
  -- the stage list and the window vocabulary (see the VOCABULARY NOTE above).
  policy      JSONB       NOT NULL,

  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Privileged-reassignment audit detail (Story 1.3) ─────────────────────
-- `merchant_relationship_owner_history` already exists (activation-ops S2) and
-- is already written BEFORE the access-changing field (D3a) — that ordering is
-- preserved, not revisited. These three columns only widen WHAT the existing
-- row records. All nullable: the promoter-facing owner route
-- (`POST /api/promoter/relationship/[id]/owner`) keeps writing rows with no
-- reason, exactly as it ships today.
ALTER TABLE merchant_relationship_owner_history
  -- REQUIRED by the ADMIN reassignment route (422 without one); NULL for the
  -- promoter-facing route's rows, which never required one.
  ADD COLUMN IF NOT EXISTS reason            TEXT,
  -- When the reassignment takes effect (defaults to now at the route level).
  ADD COLUMN IF NOT EXISTS effective_at      TIMESTAMPTZ,
  -- How many OPEN tasks moved to the new steward with this reassignment.
  -- 0 is a real answer ("the request said don't transfer them"); NULL means a
  -- row written by a path that never had the concept.
  ADD COLUMN IF NOT EXISTS tasks_transferred INT;

-- RLS: ON with NO policies, same posture as every other table in this family
-- (`merchant_relationships`, `merchant_relationship_*`): the app reaches
-- Supabase exclusively through the service-role key, which bypasses RLS, so
-- enabling it costs nothing while removing anon/authenticated access entirely
-- under standard public-schema grants.
ALTER TABLE merchant_sla_policy ENABLE ROW LEVEL SECURITY;

-- ── 4. Dark-launch flag (enablement polarity, born OFF) ─────────────────────
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('promoter.partner_portfolio_enabled', false, 'enablement',
    'Cartera de comercios del Socio: con la flag encendida, /partner muestra la sección de cartera (comercios con acceso otorgado u hospedados por el socio, ordenados por vencimiento) y se habilitan GET /api/partner/portfolio, GET/PUT /api/admin/sla-policy y POST /api/admin/relationship/[id]/reassign. Con la flag apagada /partner queda idéntico a hoy y esas rutas responden 404, indistinguible de una ruta ausente. Actívala solo después de las pruebas de dos socios, de que la reasignación conserve la atribución y de que la migración esté verificada en vivo.')
ON CONFLICT (key) DO NOTHING;
