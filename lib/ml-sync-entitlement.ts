/**
 * lib/ml-sync-entitlement.ts
 *
 * The PURE entitlement seam for the Mercado Libre sync paid/promoter SKU (epic 03 ·
 * mercadolibre-sync, Sprint 5 · US-14). "Is this shop allowed to enable ML sync?"
 * derived in ONE place — a faithful clone of the custom-domain / subdomain seams
 * (`lib/domain-entitlement.ts` / `lib/subdomain-entitlement.ts`) onto the ML-sync SKU.
 *
 * Reuses the exact grant shape, parser, and deriver. The divergences:
 *   1. the grant lives at `metadata.ml_sync_grant` (its own SKU key, so a
 *      domain/subdomain grant never leaks ML-sync entitlement or vice versa);
 *   2. this sprint ships the GATE + a comp/one_time grant path only — there is NO
 *      recurring ML-sync subscription yet (deferred fast-follow), so the deriver's
 *      `hasActiveSubscription` input is simply left unset. When the paid checkout
 *      lands, add a `hasActiveMlSyncSubscription` lookup in the server composer,
 *      exactly as the subdomain seam did.
 *
 * PURE + next-free + no `server-only` — importable by the Playwright `api` runner
 * (unit tests) and any server surface. The async composition (reading the flag +
 * the shop row) lives in `lib/ml-sync-entitlement-server.ts`.
 */

import {
  deriveDomainEntitlement,
  readGrant,
  type DomainGrant,
  type DomainEntitlement,
} from '@/lib/domain-entitlement'

export type { DomainGrant, DomainEntitlement }

/** Metadata key holding the ML-sync SKU's durable grant (distinct per SKU). */
export const ML_SYNC_GRANT_KEY = 'ml_sync_grant'

/**
 * Parse the ML-sync grant off `metadata.ml_sync_grant`. Same defensive rule as the
 * custom-domain/subdomain readers (corrupt/half-written grants never entitle).
 */
export function readMlSyncGrant(metadata: unknown): DomainGrant | null {
  return readGrant(metadata, ML_SYNC_GRANT_KEY)
}

/**
 * The pure ML-sync entitlement decision: may this shop ENABLE ML sync?
 *
 * `entitled` when the paywall is OFF (today's behavior — any connected seller may
 * enable), OR a grandfather/comp grant is present, OR a live one-time grant covers
 * it. Paywall ON + no grant (+ no subscription, unset this sprint) ⇒ not entitled →
 * the seller sees the upsell. Never throws.
 */
export function deriveMlSyncEntitlement(input: {
  paywallEnabled: boolean
  grant: DomainGrant | null
  hasActiveSubscription?: boolean
  now?: Date
}): DomainEntitlement {
  return deriveDomainEntitlement(input)
}
