-- Merchant Partner lifecycle · Sprint 2 — additive, scoped to miyagisanchez
-- (shared Supabase). The builder does NOT apply this file — the ORCHESTRATOR
-- applies it by hand via the Supabase MCP `apply_migration` (the auto-mode
-- classifier blocks the `supabase db query` CLI path), then aligns
-- `schema_migrations`. A merged file is NOT an applied migration; verify with
-- to_regclass / information_schema per LEARNINGS "Supabase migration file vs.
-- actually-applied":
--
--   -- via the Supabase MCP:
--   apply_migration(name: 'partner_portfolio_s2', query: <this file>)
--   -- or, on the CLI path, in this order:
--   supabase db query --linked --file supabase/migrations/20260725110000_partner_portfolio_s2.sql
--   supabase migration repair --status applied 20260725110000 --linked
--
-- Never `supabase db push` in this repo — many local files are unrecorded
-- remotely, so a push would replay all of them.
--
-- What this adds, on top of Sprint 1 (20260725100000_partner_portfolio_s1.sql):
--
--   1. `merchant_followup_drafts` — one row per generated follow-up draft
--      (Story 2.1), carrying its provenance (`generator`/`generator_version`/
--      `fact_ids`/`created_by`) AND, additively, the Story 2.3 confirmation
--      columns (`confirmed_at`/`confirmed_by`/`confirmed_channel`/
--      `confirmed_text`) on the SAME row — a draft and its eventual
--      human-confirmed send are one lifecycle, not two tables that could
--      drift out of sync.
--   2. `merchant_followup_reminders` — one row per CLAIMED steward reminder
--      (Story 2.2). `UNIQUE (relationship_id, kind, window_key)` is the
--      idempotency guarantee ITSELF (README D6) — the application code never
--      SELECTs to check "have we already reminded this window"; it INSERTs
--      and treats a `23505` unique-violation as "yes, skip".
--
-- NO NEW FLAG. Both surfaces are gated by the SAME
-- `promoter.partner_portfolio_enabled` flag Sprint 1 already seeded — there
-- is nothing new to dark-launch independently.
--
-- VOCABULARY NOTE (cited, never restated): `generator` is CHECK'd to exactly
-- the two values README D4 names (`'template'`, `'model'`) — the seam D4
-- deliberately leaves open for a future swap. Nothing else in this file
-- restates a stage list, an overdue rule or an outcome vocabulary; those
-- continue to live in `lib/merchant-stage.ts`, `lib/relationship-pipeline.ts`,
-- `lib/portfolio/sla.ts` and `lib/scorecard/dictionary.ts`.

-- ── 1. Follow-up drafts + their confirmation (Story 2.1 + Story 2.3) ────────
CREATE TABLE IF NOT EXISTS merchant_followup_drafts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,

  -- Which of the four es-MX intents (`lib/portfolio/draft-compose.ts`
  -- `DRAFT_TEMPLATE_IDS`) produced this draft. Free TEXT rather than a CHECK
  -- enum — the template vocabulary lives in code (D3-style: never restate a
  -- vocabulary that already exists in exactly one place), and a CHECK here
  -- would fork it the moment a fifth template is added.
  template_id       TEXT        NOT NULL,

  -- README D4 — the seam a future model-backed generator swaps into. 'template'
  -- is the ONLY value this epic ever writes; 'model' exists so that swap needs
  -- no migration of its own.
  generator         TEXT        NOT NULL CHECK (generator IN ('template', 'model')),
  generator_version INT         NOT NULL,

  -- The exact allowlisted fact ids (`lib/portfolio/draft-facts.ts`
  -- `DraftFactId`) that fed this draft — the audit trail Story 2.1 requires
  -- ("input fact ids ... are auditable"). TEXT[], not a CHECK'd enum array,
  -- for the same "don't restate the vocabulary" reason as `template_id`.
  fact_ids          TEXT[]      NOT NULL DEFAULT '{}',

  draft_text        TEXT        NOT NULL,
  -- The human's edit, if any. NULL means "never edited" — distinct from an
  -- empty string, which would mean "edited down to nothing".
  edited_text       TEXT,

  created_by        TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Story 2.3 — the no-auto-send provenance boundary ──────────────────
  -- Populated ONLY by `POST .../draft/[draftId]/confirm`. The server never
  -- sends anything when it writes these columns — it records that a HUMAN
  -- did, and returns a deep link for the BROWSER to open (README D5).
  confirmed_at       TIMESTAMPTZ,
  confirmed_by       TEXT,
  -- One of the merchant's KNOWN contact channels
  -- (`lib/portfolio/confirm.ts#ConfirmChannel`) — never a free-form value,
  -- and never restated as a CHECK here (the four-value vocabulary lives in
  -- that file, not in two places).
  confirmed_channel  TEXT,
  -- The EXACT text the human approved — may differ from `edited_text` if the
  -- partner tweaked it once more at confirm time; this is what actually
  -- reached (or was meant to reach) the merchant, so it is the audit
  -- record's own copy, never a foreign-key-only pointer back to a text that
  -- could later be edited out from under it.
  confirmed_text     TEXT
);

CREATE INDEX IF NOT EXISTS merchant_followup_drafts_relationship_idx
  ON merchant_followup_drafts (relationship_id, created_at DESC);

-- ── 2. Idempotent steward reminders (Story 2.2) ──────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_followup_reminders (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id        UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,

  -- `lib/portfolio/reminders.ts#ReminderKind` — free TEXT, same
  -- don't-restate-the-vocabulary reasoning as `template_id` above.
  kind                   TEXT        NOT NULL,
  -- `lib/portfolio/reminders.ts#reminderWindowKey` — a stable string per
  -- logical window. THE IDEMPOTENCY GUARANTEE ITSELF lives in the UNIQUE
  -- constraint below, never in application-code dedupe logic.
  window_key             TEXT        NOT NULL,

  -- Who this reminder was addressed to at claim time (may be NULL — an
  -- escalation-target-only or admin-only reminder has no steward).
  steward_clerk_user_id  TEXT,

  -- Populated by the SAME write that claims the row is NOT how this works —
  -- see `lib/portfolio/reminders-server.ts#claimAndDeliver`: the row is
  -- INSERTed (the claim) and then UPDATEd with the delivery outcome. Both
  -- columns start NULL/empty and are filled in by that second write.
  sent_at                TIMESTAMPTZ,
  channels               TEXT[]      NOT NULL DEFAULT '{}',
  -- Non-NULL when the LATEST delivery attempt for this window failed —
  -- "quiet/failure state is visible" (build contract): the portfolio surfaces
  -- "recordatorio no entregado" by reading this column, rather than a
  -- reminder rail that can go silently dead with no operator-visible trace.
  last_error             TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE IDEMPOTENCY GUARANTEE (README D6): a same-window claim attempt hits
  -- this constraint and the application code treats the resulting `23505` as
  -- "already reminded, skip silently" — never a SELECT-then-INSERT.
  UNIQUE (relationship_id, kind, window_key)
);

CREATE INDEX IF NOT EXISTS merchant_followup_reminders_relationship_idx
  ON merchant_followup_reminders (relationship_id, created_at DESC);

-- RLS: ON with NO policies, same posture as every other table in this family
-- — the app reaches Supabase exclusively through the service-role key, which
-- bypasses RLS, so enabling it costs nothing while removing anon/authenticated
-- access entirely under standard public-schema grants.
ALTER TABLE merchant_followup_drafts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_followup_reminders ENABLE ROW LEVEL SECURITY;
