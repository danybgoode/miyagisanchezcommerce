/**
 * Pure checkout admission gate for public marketplace items.
 *
 * A cart is a money-path write. It may fetch a Medusa product only AFTER this
 * gate confirmed that the exact public marketplace detail response was scoped
 * to the requested market. This prevents a guessed product id from using the
 * unrestricted product endpoint as a catalog/publication bypass.
 */
import { readMarketFilterState } from './market-catalog'
import type { MarketCode } from './markets'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isCheckoutListingAdmitted(
  payload: unknown,
  market: MarketCode,
  productId: string,
): boolean {
  // Unlike an ordinary MX browse read, a checkout cannot use the legacy
  // missing-echo compatibility window: allowing a money path to proceed when
  // we cannot prove the filter ran would make a direct product id a bypass.
  if (readMarketFilterState(payload, market) !== 'confirmed') return false
  const listing = record(record(payload)?.listing)
  return listing?.id === productId && listing.medusa_product_id === productId
}
