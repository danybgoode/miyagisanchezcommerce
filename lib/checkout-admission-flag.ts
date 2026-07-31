/**
 * lib/checkout-admission-flag.ts — the single server-side read of
 * `catalog.owned_shop_only_enabled` (epic 07 · owned-shop-operating-channel, D8).
 *
 * WHY THIS IS ITS OWN MODULE, and why the caller reaches it dynamically:
 * `lib/flags.ts` imports `server-only`, which throws the instant it is evaluated
 * anywhere but a server request. `lib/cart.ts` — the only caller — is imported for
 * its TYPES by client components and imported directly by the Playwright `api`
 * specs, and a static flag import there breaks module evaluation in both (verified:
 * with the import in place `e2e/personalization-checkout.spec.ts` cannot even
 * load). So `lib/cart.ts` `await import()`s this module at request time.
 *
 * Keeping the `isEnabled` call HERE — in `lib/`, with a literal key — is what keeps
 * `scripts/derive-flag-inventory.ts` able to see the callsite. A flag registered in
 * the catalog with no derivable callsite reddens `e2e/flag-inventory.spec.ts`, which
 * is the guard against exactly the half-flag D8 warns about.
 */
import { isEnabled } from '@/lib/flags'

/**
 * D8's kill-switch. OFF (the fail-open default) means checkout admission is
 * today's marketplace-publication proof, unchanged.
 */
export function ownedShopOnlyEnabled(): Promise<boolean> {
  return isEnabled('catalog.owned_shop_only_enabled')
}
