-- catalog-management · Sprint 6, Story 6.1 — seed the seller-shell kill-switch
-- into the in-house flag store (epic 09 · feature-flags-inhouse). Behavior-
-- preserving: seeds ON (= DEFAULT_FLAGS in lib/flags.ts), matching today's
-- target behavior — an absent row already falls open to the same default, so
-- this is a no-op until an admin deliberately flips it OFF in /admin/flags.
--
-- seller.shell_on_sell_enabled gates the owner-aware branch (frontend only)
-- that renders the seller shell (dark top bar + SellerNav) over /sell and
-- /sell/setup for a signed-in shop owner, instead of buyer chrome. OFF ⇒
-- those two routes revert to buyer chrome instantly, no redeploy.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('seller.shell_on_sell_enabled', true, 'killswitch', 'Seller shell over /sell + /sell/setup for a signed-in shop owner (catalog-management S6). OFF ⇒ instant revert to buyer chrome.')
ON CONFLICT (key) DO NOTHING;
