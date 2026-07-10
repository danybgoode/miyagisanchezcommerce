-- Sprint 4 (frontend-vercel-to-cloudrun) — documented column-reuse, not a rename/migration.
--
-- custom_domain_vercel_ok's NAME is a Vercel-era legacy; its semantics are now
-- provider-neutral ("the domain provider confirmed the domain/hostname is
-- registered" — Vercel until Sprint 4, Cloudflare Custom Hostnames from
-- Sprint 4 onward). The value itself was never Vercel-shaped, only the name
-- is legacy, and it has real blast radius (route.ts, domain-lapse-server.ts,
-- seller settings UI, admin tenant directory) — renaming buys nothing a
-- code comment doesn't. This migration only documents that decision in the
-- database itself; it changes no data and no application behavior.

COMMENT ON COLUMN marketplace_shops.custom_domain_vercel_ok IS
  'Provider-neutral: true once the active domain provider (Vercel pre-Sprint-4, Cloudflare Custom Hostnames from Sprint 4 of frontend-vercel-to-cloudrun) has registered/provisioned the domain. Name is a Vercel-era legacy, kept via documented column-reuse.';
