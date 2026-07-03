-- Promoter Funnel v2 · Sprint 4 — seed the net-remittance kill-switch into the
-- in-house flag store (epic 09 · feature-flags-inhouse). Behavior-preserving:
-- seeds OFF (= DEFAULT_FLAGS), so this is a no-op until Daniel deliberately flips
-- it in /admin/flags — per LEARNINGS, a flag-gated money path merges dark
-- (merge → deploy → seed/config → flip).
--
-- `promoter.transfer_enabled` gates ONLY where a new transfer can be CREATED —
-- the SPEI/DiMo/CoDi option at the promoter close (US-4.1) — off ⇒ the close
-- checkout only ever offers Stripe (today's behavior), unchanged. Deliberately
-- does NOT gate admin review of an already-reported transfer (US-4.2, Clerk-
-- admin-gated regardless) — real cash already collected must stay resolvable
-- even if this flag is later flipped off to pause new closes. ON CONFLICT DO
-- NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('promoter.transfer_enabled', false, 'enablement', 'Net-remittance (SPEI/DiMo/CoDi) promoter close, epic 08 S4. OFF ⇒ Stripe-only close checkout.')
ON CONFLICT (key) DO NOTHING;
