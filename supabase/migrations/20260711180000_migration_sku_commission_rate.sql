-- Platform migrations · Sprint 2 (Story 2.1) — seed the `migration` promoter SKU's
-- commission rate. Additive, scoped to miyagisanchez (shared Supabase, service-role
-- only, no RLS policies — same convention as every marketplace_* table here).
--
-- Unlike prior SKU rows (seeded at 0%, left for the admin to set post-merge — see
-- 20260630120000_promoter_commission.sql), the 50% rate for `migration` was already
-- accepted at grooming (2026-07-09, epic platform-migrations sprint-2.md Context),
-- so it seeds directly at the agreed rate rather than a 0% floor. The commission
-- rate carries no dark-launch risk on its own — the SKU stays unsellable until an
-- admin separately prices it via `marketplace_promoter_sku_prices` (Story 2.1's real
-- gate, exercised in the Sprint 2 smoke walkthrough).
INSERT INTO marketplace_promoter_commission_rates (sku, rate_pct) VALUES
  ('migration', 50)
ON CONFLICT (sku) DO NOTHING;
