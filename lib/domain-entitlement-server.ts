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
  type DomainEntitlement,
} from '@/lib/domain-entitlement'

/**
 * Resolve a shop's custom-domain entitlement from its `metadata` JSONB.
 * `hasActiveSubscription` is a Sprint-2 hook (no paid plan exists yet in S1).
 */
export async function resolveDomainEntitlement(
  metadata: unknown,
  opts?: { hasActiveSubscription?: boolean },
): Promise<DomainEntitlement> {
  const paywallEnabled = await isEnabled('domain.paywall_enabled')
  return deriveDomainEntitlement({
    paywallEnabled,
    grant: readDomainGrant(metadata),
    hasActiveSubscription: opts?.hasActiveSubscription,
  })
}
