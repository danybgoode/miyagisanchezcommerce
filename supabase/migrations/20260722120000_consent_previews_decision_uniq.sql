-- Founding merchant consent-safe previews · post-review hardening — additive,
-- scoped to miyagisanchez (shared Supabase).
--
-- Apply with the Supabase CLI (a merged file is NOT an applied migration):
--   supabase db query --linked --file supabase/migrations/20260722120000_consent_previews_decision_uniq.sql
--   supabase migration repair --status applied 20260722120000 --linked
-- Do NOT use `supabase db push` in this repo — 44 local migrations are unrecorded
-- in the remote history, so a push would try to replay all of them.

-- One decision per (preview, version). The application now compare-and-sets the
-- anchor on `current_version`, which makes two racing decisions resolve to one
-- winner — but the CAS alone protects the ANCHOR, not the log: both racers still
-- insert a decision row at the same version, leaving an append-only consent record
-- with two contradictory entries claiming to be the same version.
--
-- On a consent record that ambiguity is the whole problem: it is the artifact you
-- would reach for to prove what the merchant actually agreed to and when. This
-- index makes the duplicate impossible at the storage layer, so the log stays a
-- total order regardless of what the application does.
--
-- Safe to add against live data: the epic's flag has never been ON, so the table
-- is empty in production (verified 2026-07-22). If a future environment does hold
-- rows, a duplicate (preview_id, version) pair would have to be reconciled by hand
-- before this can apply — which is the correct, loud failure.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_preview_decisions_version_uniq
  ON merchant_preview_decisions (preview_id, version);
