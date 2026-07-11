-- Onboarding three-doors epic, Sprint 1 · Story 1.1 — the S1 Bienvenida
-- welcome-intake store. Non-commerce (AGENTS Rule 2): what a fresh merchant
-- sells (Q1) and where they sell today (Q2), plus which of the three doors
-- they picked. One row per Clerk user, upserted from the API route. No RLS
-- (matches marketplace_favorites/marketplace_conversations — service-role
-- access only, via the API route's Clerk-gated read/write).

CREATE TABLE tenant_intake (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id  TEXT        NOT NULL UNIQUE,
  sells          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sells_where    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  chosen_door    TEXT        CHECK (chosen_door IN ('agent', 'import', 'wizard')),
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_tenant_intake_user ON tenant_intake(clerk_user_id);
