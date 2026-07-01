/**
 * lib/ml-sync-entitlement-server.ts
 *
 * Server-side composer for the ML-sync paid/promoter-SKU gate (epic 03 ·
 * mercadolibre-sync, Sprint 5 · US-14). A faithful clone of
 * `lib/subdomain-entitlement-server.ts`: reads the rollout flag (fail-open) + the
 * durable grant off the shop's metadata, then runs the pure deriver.
 *
 * This sprint has NO recurring ML-sync subscription (deferred fast-follow), so
 * there is no subscription lookup — entitlement is flag + grant only (a comp grant
 * entitles testers; a live one-time grant entitles a paid buyer once the checkout
 * path lands). Keep the pure logic in `lib/ml-sync-entitlement.ts` so the Playwright
 * `api` runner can unit-test it without pulling in `server-only`.
 *
 * FAIL-SAFE by design: `ml.sync_paywall_enabled` defaults OFF, so if the flag store
 * is unreachable (or the flag is simply not flipped) every connected seller stays
 * entitled — an already-enabled tester can never be trapped behind the paywall.
 */
import 'server-only'
import { isEnabled } from '@/lib/flags'
import { readMlSyncGrant, deriveMlSyncEntitlement } from '@/lib/ml-sync-entitlement'
import type { DomainEntitlement } from '@/lib/domain-entitlement'

/**
 * Resolve a shop's ML-sync entitlement from its `metadata` JSONB. Reads the
 * `ml.sync_paywall_enabled` flag (fail-open ⇒ entitled) + the `ml_sync_grant`.
 */
export async function resolveMlSyncEntitlement(metadata: unknown): Promise<DomainEntitlement> {
  const paywallEnabled = await isEnabled('ml.sync_paywall_enabled')
  const grant = readMlSyncGrant(metadata)
  return deriveMlSyncEntitlement({ paywallEnabled, grant })
}
