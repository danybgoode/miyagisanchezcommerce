-- Promoter Funnel v2 · Sprint 3 (US-3.3) — race-safety for the 2x1 clone insert.
-- Caught in cross-agent review of PR #165: two concurrent paid-confirmations for the
-- same submission (a Stripe webhook retry racing itself, or a webhook + a manual
-- admin confirm) could both pass the in-app `shouldAttemptClone` read before either
-- write lands, producing two comped clones for one original. A partial UNIQUE index
-- on `content->>'is_2x1_clone_of'` makes the SECOND insert hit a real DB constraint
-- (23505), which lib/print-server.ts#cloneSubmissionInto2x1Edition now swallows as a
-- benign "already cloned" — mirrors marketplace_promoter_attributions_uniq's exact
-- shape (20260629120000_promoter.sql).
CREATE UNIQUE INDEX IF NOT EXISTS print_ad_submissions_2x1_clone_of_uniq
  ON print_ad_submissions ((content ->> 'is_2x1_clone_of'))
  WHERE content ->> 'is_2x1_clone_of' IS NOT NULL;
