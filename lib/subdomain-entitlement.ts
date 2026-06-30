/**
 * lib/subdomain-entitlement.ts
 *
 * The PURE entitlement seam for the subdomain paywall (epic 07 ·
 * subdomain-pricing, Sprint 1). A faithful clone of the custom-domain seam
 * (`lib/domain-entitlement.ts`) onto the subdomain SKU — "is this shop allowed to
 * serve its white-label `<slug>.miyagisanchez.com` subdomain?" derived in ONE
 * place so the rule can never drift.
 *
 * Reuses the exact grant shape, parsing rule, and deriver from the custom-domain
 * seam (grandfather ∨ comp ∨ live one-time ∨ active subscription). The ONLY
 * divergences from the custom-domain SKU:
 *   1. the grant lives at `metadata.subdomain_grant` (NOT `custom_domain_grant`),
 *      so a custom-domain grant never leaks subdomain entitlement (or vice versa)
 *      — they are distinct SKUs at distinct prices;
 *   2. grandfather is stamped on EVERY shop at cutover (every shop has a free
 *      subdomain today), via `scripts/backfill-subdomain-grandfather.mjs`.
 *
 * PURE + next-free + no `server-only` — so it's importable by BOTH the Node-runtime
 * middleware (the gate) AND the Playwright `api` runner (unit tests). The async
 * composition (reading the flag + the shop row) happens inline in `middleware.ts`;
 * Sprint 2 adds the recurring-subscription input when the paid path lands.
 */

import {
  deriveDomainEntitlement,
  readGrant,
  type DomainGrant,
  type DomainEntitlement,
} from '@/lib/domain-entitlement'

export type { DomainGrant, DomainEntitlement }

/** Metadata key holding the subdomain SKU's durable grant (distinct per SKU). */
export const SUBDOMAIN_GRANT_KEY = 'subdomain_grant'

/**
 * Parse the subdomain grant off `metadata.subdomain_grant`. Same defensive rule
 * as the custom-domain reader (corrupt/half-written grants never entitle).
 */
export function readSubdomainGrant(metadata: unknown): DomainGrant | null {
  return readGrant(metadata, SUBDOMAIN_GRANT_KEY)
}

/**
 * The exact branch the middleware subdomain gate takes, as a pure decision:
 * serve the white-label subdomain, or 301 to the free `/s/slug`.
 *
 * `redirect` ONLY when the paywall is on AND the shop is not entitled; every
 * other case (flag off, grandfathered, comp, live one-time, active subscription)
 * serves white-label exactly as today. Never throws.
 */
export function subdomainServeDecision(input: {
  paywallEnabled: boolean
  grant: DomainGrant | null
  /** Active subdomain subscription (recurring cadence) — wired in Sprint 2. */
  hasActiveSubscription?: boolean
  /** Injectable clock for the one-time lapse (defaults to real now). */
  now?: Date
}): 'white-label' | 'redirect' {
  const { entitled } = deriveDomainEntitlement(input)
  return entitled ? 'white-label' : 'redirect'
}
