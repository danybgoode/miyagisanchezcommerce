/**
 * lib/domain-entitlement-server.ts
 *
 * Server-side composer for the custom-domain paywall. Reads the rollout flag
 * (Flagsmith, fail-open) + the durable grant off the shop's metadata, then runs
 * the pure deriver. Every domain mutation route and the connect UI call THIS so
 * the entitlement rule lives in exactly one place.
 *
 * Imports `@/lib/flags` (server-only) — keep the pure logic + types in
 * `lib/domain-entitlement.ts` so the Playwright `api` runner can unit-test the
 * seam without pulling in `server-only`/`flagsmith-nodejs`.
 */
import 'server-only'
import { isEnabled } from '@/lib/flags'
import {
  deriveDomainEntitlement,
  readDomainGrant,
  isOneTimeGrantLive,
  type DomainEntitlement,
} from '@/lib/domain-entitlement'
import { hasActiveCustomDomainSubscription } from '@/lib/domain-subscription'

/**
 * Resolve a shop's custom-domain entitlement from its `metadata` JSONB.
 *
 * Sprint 2 wires the paid path: pass `sellerClerkId` and this resolves the
 * seller's Medusa custom-domain subscription (the source of truth) to feed the
 * deriver's `hasActiveSubscription`. Callers that have already computed it (or a
 * unit test) may pass `hasActiveSubscription` directly to skip the lookup.
 */
export async function resolveDomainEntitlement(
  metadata: unknown,
  opts?: { sellerClerkId?: string; hasActiveSubscription?: boolean },
): Promise<DomainEntitlement> {
  const paywallEnabled = await isEnabled('domain.paywall_enabled')

  // Skip the subscription lookup entirely when the paywall is off (everyone
  // ungated) or an ENTITLING grant already covers the shop — saves a backend
  // round-trip on the common path; the deriver's precedence (flag → grant →
  // subscription) makes the result identical either way. An EXPIRED one-time
  // grant is still a (truthy) grant but no longer entitles, so we must NOT skip
  // the lookup for it — a seller who lapsed one-time and re-subscribed recurring
  // would otherwise wrongly read as `none`.
  const grant = readDomainGrant(metadata)
  const grantEntitles =
    grant?.type === 'grandfather' || grant?.type === 'comp' || isOneTimeGrantLive(grant)
  let hasActiveSubscription = opts?.hasActiveSubscription
  if (hasActiveSubscription === undefined && paywallEnabled && !grantEntitles && opts?.sellerClerkId) {
    hasActiveSubscription = await hasActiveCustomDomainSubscription(opts.sellerClerkId)
  }

  return deriveDomainEntitlement({ paywallEnabled, grant, hasActiveSubscription })
}
