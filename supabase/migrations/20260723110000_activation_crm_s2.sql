-- Founding merchant activation operations · Sprint 2 — additive, scoped to
-- miyagisanchez (shared Supabase). The builder does NOT apply this file — the
-- orchestrator does, by hand, in this order (a merged file is NOT an applied
-- migration; verify with to_regclass per LEARNINGS "Supabase migration file
-- vs. actually-applied"):
--
--   supabase db query --linked --file supabase/migrations/20260723110000_activation_crm_s2.sql
--   supabase migration repair --status applied 20260723110000 --linked
--
-- Never `supabase db push` in this repo — dozens of local files are
-- unrecorded remotely, so a push would replay all of them.
--
-- What this adds: the four Sprint-2 tables the D3 stage resolver's write side
-- needs (README "stage is DERIVED, corrections are the only writes" —
-- `lib/merchant-stage.ts`'s resolver itself is pure and reads nothing; in
-- THIS sprint the only writer of `merchant_relationship_transitions` is the
-- admin correction route, `POST /api/admin/relationship/[id]/correct-stage`.
-- The automated derived-advance write path — one row per stage using
-- `dedupe_key = <to_stage>` — is Sprint 3's commerce-fact adapter; the UNIQUE
-- constraint below is what will make ITS replay a no-op BY CONSTRAINT):
--
--   merchant_relationship_transitions      — immutable stage history + corrections
--   merchant_relationship_interactions     — append-only notes/calls/visits/etc.
--   merchant_relationship_tasks            — the dated next action
--   merchant_relationship_owner_history    — steward reassignment audit trail
--
-- STAGE VOCABULARY NOTE (flagged for the architect, not silently resolved):
-- sprint-2.md's prose names stage 3 `permission_received`. This migration
-- follows the ALREADY-APPLIED Sprint 1 CHECK constraint on
-- `merchant_relationships.stage` (and README D2, and the live
-- `MERCHANT_LIFECYCLE_EVENTS` vocabulary in lib/merchant-lifecycle.ts), which
-- both use `permission_granted` — a transition row using the prose's slug
-- would be rejected the instant anything tried to write it, since it isn't a
-- value either CHECK constraint accepts. If `permission_received` was
-- actually intended, both CHECK constraints need a coordinated follow-up
-- migration, never a silent one-sided rename in only one of them. See
-- lib/merchant-stage.ts's header for the same note against the resolver.

CREATE TABLE IF NOT EXISTS merchant_relationship_transitions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,

  -- Nullable: the very first transition off the S1-default 'scouted' row may
  -- be written before anything ever recorded an explicit prior stage.
  from_stage        TEXT        CHECK (from_stage IS NULL OR from_stage IN (
                        'scouted', 'qualified', 'permission_granted', 'preview_in_preparation',
                        'preview_delivered', 'activation_scheduled', 'claimed', 'payments_ready',
                        'three_products_live', 'shared_externally', 'first_inquiry', 'first_sale',
                        'retained_30d'
                      )),
  to_stage          TEXT        NOT NULL CHECK (to_stage IN (
                        'scouted', 'qualified', 'permission_granted', 'preview_in_preparation',
                        'preview_delivered', 'activation_scheduled', 'claimed', 'payments_ready',
                        'three_products_live', 'shared_externally', 'first_inquiry', 'first_sale',
                        'retained_30d'
                      )),
  -- Frozen 1–13 (lib/merchant-stage.ts#STAGE_ORDINAL) — the Sprint 3
  -- reconciliation view reads this column directly rather than re-deriving
  -- it from `to_stage` every time.
  to_stage_ordinal  INT         NOT NULL CHECK (to_stage_ordinal BETWEEN 1 AND 13),
  actor_type        TEXT        NOT NULL CHECK (actor_type IN ('promoter', 'admin', 'system', 'commerce_fact')),
  actor_id          TEXT,
  reason            TEXT,
  evidence_ref      JSONB,
  dedupe_key        TEXT        NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Replay is a no-op BY CONSTRAINT, never by a SELECT-then-INSERT — the
  -- exact discipline the sibling `merchant-lifecycle-projection` epic paid
  -- nine defects to learn (Roadmap/LEARNINGS.md). Natural key: `<to_stage>`
  -- for a derived advance (lib/merchant-stage.ts#advanceDedupeKey),
  -- `correction:<uuid>` for a correction (#correctionDedupeKey) — a fresh
  -- uuid per correction means this constraint never blocks two DIFFERENT
  -- corrections on the same relationship.
  UNIQUE (relationship_id, dedupe_key),

  -- A CORRECTION requires a reason — a DB CHECK, not route-code convention
  -- (build contract: the route returns 422 without one; this is the
  -- database's independent backstop so no future writer can skip it).
  CHECK (dedupe_key NOT LIKE 'correction:%' OR reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS merchant_relationship_transitions_relationship_idx
  ON merchant_relationship_transitions (relationship_id, occurred_at DESC);

-- Append-only interaction log (Story 2.2 — "authorized users append
-- interactions/notes"). No UPDATE path exists at all, at the schema or the
-- route level: an edit is a NEW row, mirroring `merchant_relationship_field_audit`'s
-- (S1) and `merchant_preview_decisions`'s (consent-previews) append-only shape.
CREATE TABLE IF NOT EXISTS merchant_relationship_interactions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id       UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  kind                  TEXT        NOT NULL CHECK (kind IN ('note', 'call', 'whatsapp', 'visit', 'email', 'other')),
  body                  TEXT,
  author_clerk_user_id  TEXT        NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_relationship_interactions_relationship_idx
  ON merchant_relationship_interactions (relationship_id, occurred_at DESC);

-- The dated next action (Story 2.2 — "set/complete a dated next action").
-- Completing WRITES completed_at; it never deletes the row.
CREATE TABLE IF NOT EXISTS merchant_relationship_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id  UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  due_at           TIMESTAMPTZ,
  assigned_to      TEXT,
  completed_at     TIMESTAMPTZ,
  completed_by     TEXT,
  created_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "The next action" is the earliest-due OPEN task (lib/relationship-pipeline.ts
-- #nextOpenTask) — this partial index is exactly that query's access path
-- (WHERE completed_at IS NULL ORDER BY due_at).
CREATE INDEX IF NOT EXISTS merchant_relationship_tasks_open_idx
  ON merchant_relationship_tasks (relationship_id, due_at)
  WHERE completed_at IS NULL;

-- Steward reassignment audit trail (Story 2.2 — "reassign an owner with
-- history"). Written by the reassign route in the SAME request as the
-- `merchant_relationships.steward_clerk_user_id` update.
CREATE TABLE IF NOT EXISTS merchant_relationship_owner_history (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id      UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  from_steward         TEXT,
  to_steward           TEXT,
  actor_clerk_user_id  TEXT        NOT NULL,
  at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_relationship_owner_history_relationship_idx
  ON merchant_relationship_owner_history (relationship_id, at DESC);

-- RLS: ON with NO policies, on ALL FOUR tables — same posture as
-- `merchant_relationships`/`merchant_relationship_field_audit` (S1): these
-- rows are merchant contact/operational data, and the app reaches Supabase
-- exclusively through the service-role key, which bypasses RLS. Enabling it
-- costs the app nothing while removing anon/authenticated access entirely
-- under standard public-schema grants.
ALTER TABLE merchant_relationship_transitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_relationship_interactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_relationship_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_relationship_owner_history  ENABLE ROW LEVEL SECURITY;
