/**
 * lib/ml-sync-entitlement-server.ts
 *
 * Server-side composer for the ML-sync paid/promoter-SKU gate (epic 03 ·
 * mercadolibre-sync, S5 · US-14; subscription wired in S6). A faithful clone of
 * `lib/subdomain-entitlement-server.ts`: reads the rollout flag (fail-open) + the
 * durable grant off the shop's metadata, conditionally resolves the seller's Medusa
 * ML-sync subscription, then runs the pure deriver.
 *
 * Keep the pure logic in `lib/ml-sync-entitlement.ts` so the Playwright `api` runner
 * can unit-test the seam without pulling in `server-only`.
 *
 * FAIL-SAFE by design: `ml.sync_paywall_enabled` defaults OFF, so if the flag store
 * is unreachable (or the flag is simply not flipped) every connected seller stays
 * entitled — an already-enabled tester can never be trapped behind the paywall.
 */
import 'server-only'
import { isEnabled } from '@/lib/flags'
import { readMlSyncGrant, deriveMlSyncEntitlement } from '@/lib/ml-sync-entitlement'
import { isOneTimeGrantLive, type DomainEntitlement } from '@/lib/domain-entitlement'
import { hasActiveMlSyncSubscription } from '@/lib/ml-sync-subscription'

/**
 * Resolve a shop's ML-sync entitlement from its `metadata` JSONB.
 *
 * Pass `sellerClerkId` and this resolves the seller's Medusa ML-sync subscription
 * (the source of truth) to feed the deriver's `hasActiveSubscription`. The lookup is
 * SKIPPED when the paywall is off (everyone ungated) or an entitling grant already
 * covers the shop — so a comp/grandfathered/live-one-time shop adds zero backend
 * round-trip. Callers that already have the boolean (or a unit test) may pass
 * `hasActiveSubscription` directly to skip the lookup.
 */
export async function resolveMlSyncEntitlement(
  metadata: unknown,
  opts?: { sellerClerkId?: string; hasActiveSubscription?: boolean },
): Promise<DomainEntitlement> {
  const paywallEnabled = await isEnabled('ml.sync_paywall_enabled')

  const grant = readMlSyncGrant(metadata)
  const grantEntitles =
    grant?.type === 'grandfather' || grant?.type === 'comp' || isOneTimeGrantLive(grant)
  let hasActiveSubscription = opts?.hasActiveSubscription
  if (hasActiveSubscription === undefined && paywallEnabled && !grantEntitles && opts?.sellerClerkId) {
    hasActiveSubscription = await hasActiveMlSyncSubscription(opts.sellerClerkId)
  }

  return deriveMlSyncEntitlement({ paywallEnabled, grant, hasActiveSubscription })
}
