-- buyer-notifications-money-path · Sprint 1 — seed the kill-switch flag into the
-- in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: seeds ENABLED (= DEFAULT_FLAGS in both apps' lib/flags.ts),
-- since this is a kill-switch (default ON), so this migration turns the new gating
-- ON at deploy time — not a dark launch. Flipping it OFF in /admin/flags is the
-- deliberate rollback act if a regression appears.
--
-- notifications.buyer_moneypath_enabled gates the Medusa-order buyer-id resolution
-- read by ship-manual/ship/return-request[requestId] off normalizeMedusaOrder's
-- buyer_clerk_user_id (S1), plus the payment-webhook Compras dispatch (S2). OFF ⇒
-- those routes treat the buyer id as null — the guest fall-through (email-only)
-- that ran before this epic.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('notifications.buyer_moneypath_enabled', true, 'kill-switch', 'Gates Medusa-order buyer-id resolution in seller-triggered ship/return dispatch + (S2) Compras webhook dispatch (buyer-notifications-money-path). OFF ⇒ guest fall-through, today''s email-only behavior.')
ON CONFLICT (key) DO NOTHING;
