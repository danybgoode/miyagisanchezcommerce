-- Onboarding three-doors epic, Sprint 1 — seed the dark-launch enablement
-- flag into the in-house flag store (epic 09 · feature-flags-inhouse).
-- Seeds OFF (= DEFAULT_FLAGS in lib/flags.ts): the new S1/S2/S3 first-run
-- merges dark; an absent row already falls open to the same default, so
-- this is a no-op until an admin deliberately flips it ON in /admin/flags.
--
-- onboarding.three_doors_enabled gates the redirect from /sell into the new
-- three-doors first-run (app/(shell)/sell/page.tsx) for a signed-in user
-- with no shop yet and no tenant_intake row. OFF ⇒ /sell keeps today's
-- SellWizard entry, unchanged.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('onboarding.three_doors_enabled', false, 'enablement', 'Redirect a fresh, shop-less merchant from /sell into the S1 Bienvenida → S2 Tres puertas first-run instead of today''s SellWizard entry (seller-portal-onboarding-three-doors Sprint 1).')
ON CONFLICT (key) DO NOTHING;
