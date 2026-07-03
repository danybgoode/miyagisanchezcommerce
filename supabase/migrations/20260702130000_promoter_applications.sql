-- Promoter Funnel v2 · Sprint 2 — additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.
--
-- Self-serve promoter application state — a concept Medusa has no notion of →
-- Supabase (AGENTS rule #2). Distinct from marketplace_promoters (20260629120000_promoter.sql):
-- an application is a pending REQUEST to become a promoter; approving one calls the
-- existing createPromoter() unchanged and links the resulting row via promoter_id.
-- Hand-minting (the admin "Nuevo promotor" button) has no application and keeps working as-is.

CREATE TABLE IF NOT EXISTS marketplace_promoter_applications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  whatsapp     TEXT        NOT NULL,
  city         TEXT,
  motivation   TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  promoter_id  UUID        REFERENCES marketplace_promoters (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketplace_promoter_applications_status_idx
  ON marketplace_promoter_applications (status, created_at DESC);
