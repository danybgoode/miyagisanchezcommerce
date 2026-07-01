/**
 * lib/subdomain-entitlement-server.ts
 *
 * Server-side composer for the subdomain paywall (epic 07 · subdomain-pricing,
 * Sprint 2). A faithful clone of `lib/domain-entitlement-server.ts`. Reads the
 * rollout flag (fail-open) + the durable grant off the shop's metadata,
 * conditionally resolves the seller's Medusa subdomain subscription, then runs the
 * pure deriver. The middleware subdomain gate calls THIS so the recurring-paid path
 * entitles at serve time (the subdomain IS the slug — there's nothing to "clear" on
 * lapse the way the custom domain clears its `custom_domain` field, so the gate must
 * read entitlement, subscription included, per request).
 *
 * Imports `@/lib/flags` + `@/lib/subdomain-subscription` (both server-only) — keep
 * the pure logic + types in `lib/subdomain-entitlement.ts` / `lib/domain-entitlement.ts`
 * so the Playwright `api` runner can unit-test the seam without pulling in
 * `server-only` (and the Supabase client). Safe to import from the Node-runtime middleware
 * (same as `lib/flags.ts`, already imported there).
 */
import 'server-only'
import { isEnabled } from '@/lib/flags'
import {
  deriveDomainEntitlement,
  isOneTimeGrantLive,
  type DomainEntitlement,
} from '@/lib/domain-entitlement'
import { readSubdomainGrant } from '@/lib/subdomain-entitlement'
import { hasActiveSubdomainSubscription } from '@/lib/subdomain-subscription'

/**
 * Resolve a shop's subdomain entitlement from its `metadata` JSONB.
 *
 * Pass `sellerClerkId` and this resolves the seller's Medusa subdomain
 * subscription (the source of truth) to feed the deriver's `hasActiveSubscription`.
 * The subscription lookup is SKIPPED when the paywall is off (everyone ungated) or
 * an entitling grant already covers the shop — so the grandfathered shops (which
 * carry a grandfather grant) add zero backend round-trip, identical to Sprint 1.
 * An EXPIRED one-time grant is still a (truthy) grant but no longer entitles, so we
 * must NOT skip the lookup for it. Callers that already have the boolean (or a unit
 * test) may pass `hasActiveSubscription` directly to skip the lookup.
 */
export async function resolveSubdomainEntitlement(
  metadata: unknown,
  opts?: { sellerClerkId?: string; hasActiveSubscription?: boolean },
): Promise<DomainEntitlement> {
  const paywallEnabled = await isEnabled('subdomain.paywall_enabled')

  const grant = readSubdomainGrant(metadata)
  const grantEntitles =
    grant?.type === 'grandfather' || grant?.type === 'comp' || isOneTimeGrantLive(grant)
  let hasActiveSubscription = opts?.hasActiveSubscription
  if (hasActiveSubscription === undefined && paywallEnabled && !grantEntitles && opts?.sellerClerkId) {
    hasActiveSubscription = await hasActiveSubdomainSubscription(opts.sellerClerkId)
  }

  return deriveDomainEntitlement({ paywallEnabled, grant, hasActiveSubscription })
}
