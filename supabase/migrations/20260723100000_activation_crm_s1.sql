-- Founding merchant activation operations · Sprint 1 — additive, scoped to
-- miyagisanchez (shared Supabase). The builder does NOT apply this file — the
-- orchestrator does, by hand, in this order (a merged file is NOT an applied
-- migration; verify with to_regclass per LEARNINGS "Supabase migration file
-- vs. actually-applied"):
--
--   supabase db query --linked --file supabase/migrations/20260723100000_activation_crm_s1.sql
--   supabase migration repair --status applied 20260723100000 --linked
--
-- Never `supabase db push` in this repo — 44 local files are unrecorded
-- remotely, so a push would replay all of them.
--
-- What this adds: the CANONICAL merchant relationship record (README D1 — its
-- `id` becomes the opaque merchant subject id every later sprint keys on,
-- because the relationship must be able to exist before any Medusa seller /
-- `marketplace_shops` mirror row does — scouted, qualified, permission
-- received, preview in preparation and preview delivered all precede shop
-- creation). `shop_id` is a nullable, UNIQUE link onto the existing
-- `marketplace_shops` mirror, never a copy of commerce data (AGENTS rule #1 —
-- Medusa stays authoritative for the seller itself). Two more Sprint-1 stories
-- ride this same file: the append-only field-audit trail (Story 1.3 — every
-- attribution/consent edit is audited) and the dark-launch flag.
--
-- `stage` intentionally uses the SAME 13 slugs the epic's README (D2) commits
-- to for the Sprint-2 lifecycle-event vocabulary (`merchant.<stage>`), and
-- five of those slugs (`permission_granted`, `claimed`, `three_products_live`,
-- `first_sale`, `retained_30d`) are already live `MERCHANT_LIFECYCLE_EVENTS`
-- values (lib/merchant-lifecycle.ts) — reusing the exact same words here is
-- what makes D2's "the 13 stages ARE the event types" true rather than
-- aspirational. Sprint 1 only ever writes the default ('scouted'); no
-- resolver exists yet (that's Sprint 2, D3 — stage is DERIVED, never set by a
-- UI checkbox).

CREATE TABLE IF NOT EXISTS merchant_relationships (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity — what a promoter can capture in one in-person conversation.
  business_name          TEXT        NOT NULL,
  contact_name           TEXT,
  phone_e164             TEXT,
  email_normalized       TEXT,
  whatsapp_e164          TEXT,
  instagram_handle       TEXT,

  -- Context — field notes that inform qualification, never commerce truth.
  estado                 TEXT,
  municipio              TEXT,
  location_note          TEXT,
  category               TEXT,
  current_channels       TEXT[],
  preferred_channel      TEXT        CHECK (preferred_channel IN
                             ('whatsapp', 'phone', 'email', 'instagram', 'in_person')),
  qualification          TEXT        NOT NULL DEFAULT 'unknown' CHECK (qualification IN
                             ('unknown', 'strong', 'medium', 'weak', 'disqualified')),
  fit_note               TEXT,
  objections             TEXT,

  -- Attribution — who originated the work. `promoter_id` links the acquisition
  -- ledger (marketplace_promoters); this table never replaces or copies
  -- commission/attribution rows, only references them (README "what already exists").
  promoter_id            UUID        REFERENCES marketplace_promoters(id),
  cohort                 TEXT,
  source                 TEXT,

  -- Stewardship — who currently owns following up.
  steward_clerk_user_id  TEXT,

  -- Links — never a copy. `shop_id` is UNIQUE: two relationship rows pointing
  -- at one shop is a genuine data error, so the constraint enforces it at the
  -- database rather than trusting every writer. Deliberately NOT unique on
  -- phone/email below — a family business legitimately shares a number, so a
  -- collision must prompt a human (epic Decision 3), not 23505 the intake.
  shop_id                UUID        UNIQUE,
  preview_id             UUID        REFERENCES merchant_previews(id),

  -- Lifecycle — DERIVED in Sprint 2+ (README D3); Sprint 1 only ever writes
  -- the default. `stage_entered_at` lets Sprint 2's resolver compute "age in
  -- stage" without a second timestamp table.
  stage                  TEXT        NOT NULL DEFAULT 'scouted' CHECK (stage IN (
                             'scouted',
                             'qualified',
                             'permission_granted',
                             'preview_in_preparation',
                             'preview_delivered',
                             'activation_scheduled',
                             'claimed',
                             'payments_ready',
                             'three_products_live',
                             'shared_externally',
                             'first_inquiry',
                             'first_sale',
                             'retained_30d'
                           )),
  stage_entered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  intake_complete        BOOLEAN     NOT NULL DEFAULT false,

  -- Audit.
  created_by             TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Non-unique lookup indexes for the dedupe precedence (POST /api/promoter/relationship):
-- shop_id exact (the PK/unique index above already covers that) → phone_e164
-- exact → email_normalized exact. `lower(business_name)` backs the fuzzy-suggestion
-- scan (never a merge — epic Decision 3, a human always confirms).
CREATE INDEX IF NOT EXISTS merchant_relationships_phone_idx
  ON merchant_relationships (phone_e164);
CREATE INDEX IF NOT EXISTS merchant_relationships_email_idx
  ON merchant_relationships (email_normalized);
CREATE INDEX IF NOT EXISTS merchant_relationships_promoter_stage_idx
  ON merchant_relationships (promoter_id, stage);
CREATE INDEX IF NOT EXISTS merchant_relationships_business_name_lower_idx
  ON merchant_relationships (lower(business_name));

-- Append-only field-audit trail (Story 1.3 — "edits are audited"). One row per
-- changed field per write, never mutated or deleted — the append-only
-- discipline the S1/S2 preview tables already use for their own consent log
-- (merchant_preview_decisions). `field` is free-form (not a CHECK'd enum) so a
-- later sprint can audit a new column without a migration; the *values* worth
-- trusting are the writer's job, this table just never forgets what happened.
CREATE TABLE IF NOT EXISTS merchant_relationship_field_audit (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id       UUID        NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  field                 TEXT        NOT NULL,
  old_value             TEXT,
  new_value             TEXT,
  actor_clerk_user_id   TEXT        NOT NULL,
  at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_relationship_field_audit_relationship_idx
  ON merchant_relationship_field_audit (relationship_id, at DESC);

-- Backfill (README D1): one relationship row per EXISTING marketplace_shops row,
-- so the shop → relationship resolution the lifecycle-emission seam depends on
-- always hits, even for shops created before this epic. `business_name` is
-- COALESCE'd against a blank/NULL shop name so a malformed legacy row can never
-- violate the NOT NULL constraint and abort the whole backfill. `ON CONFLICT
-- (shop_id) DO NOTHING` makes this re-runnable (the same posture as the S1/S2
-- consent-preview migrations) — running it twice, or after a shop was added
-- between two runs, only ever inserts the NEW rows.
INSERT INTO merchant_relationships (business_name, shop_id, intake_complete, created_by, stage, stage_entered_at)
SELECT
  COALESCE(NULLIF(TRIM(marketplace_shops.name), ''), 'Comercio sin nombre'),
  marketplace_shops.id,
  false,
  'backfill',
  'scouted',
  now()
FROM marketplace_shops
ON CONFLICT (shop_id) DO NOTHING;

-- RLS: ON with NO policies, on BOTH tables — same posture as `merchant_previews`
-- (S1 consent-previews migration): these rows are merchant contact data, and the
-- app reaches Supabase exclusively through the service-role key, which bypasses
-- RLS. Enabling it costs the app nothing while removing anon/authenticated
-- access entirely under standard public-schema grants.
ALTER TABLE merchant_relationships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_relationship_field_audit  ENABLE ROW LEVEL SECURITY;

-- Dark-launch flag (enablement polarity, default OFF in every env). Gates the
-- new `/promotor/cerrar` intake step and every `/api/promoter/relationship*`
-- route: OFF ⇒ those routes 404 (indistinguishable from absent) and the close
-- workspace renders byte-identical to today. ON CONFLICT DO NOTHING so
-- re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('promoter.activation_crm_enabled', false, 'enablement',
    'Registro operativo de relación con comercios fundadores: con la flag encendida, /promotor/cerrar muestra el paso de captura del comercio y las rutas de creación/consulta/consentimiento de la relación quedan activas. Actívala solo después de las pruebas de alcance por rol y la verificación en vivo de esta migración.')
ON CONFLICT (key) DO NOTHING;
