-- rental-backend-line-item-pricing · Sprint 1 — seed the rental line-item pricing
-- enablement flag into the in-house flag store (epic 09 · feature-flags-inhouse).
-- Behavior-preserving: seeds OFF (= DEFAULT_FLAGS in both apps' lib/flags.ts), so
-- this is a no-op until an admin deliberately flips it in /admin/flags after
-- Sprints 2-3 land and Daniel's flag-ON money smoke (Stripe + SPEI) passes.
--
-- checkout.rental_pricing_enabled gates the start-checkout RENTAL branch (backend,
-- already merged): a rental checkout is charged nights × rate + deposit, recomputed
-- server-side from the dates + the product attrs. OFF ⇒ the backend 422s a rental
-- checkout and the buyer is routed to today's coordination flow (PDP AskSeller).
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('checkout.rental_pricing_enabled', false, 'enablement', 'Rental checkout charged as nights × rate + deposit (rental-backend-line-item-pricing S1). OFF ⇒ backend 422s a rental checkout → today''s coordination flow.')
ON CONFLICT (key) DO NOTHING;
