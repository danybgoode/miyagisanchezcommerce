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

/**
 * The SECOND half of the same admission proof, and it exists because the first
 * half alone does not cover the money path.
 *
 * `isCheckoutListingAdmitted` proves a PRODUCT id is published to this market. The
 * thing a cart line actually buys is a VARIANT id. The caller supplies both
 * (`/api/checkout/start` passes `await req.json()` straight through), so if they are
 * allowed to disagree, the proof and the purchase describe different objects: pair
 * an admitted marketplace productId with a variant belonging to an unpublished
 * product and the market boundary is bypassed with the gate still green.
 *
 * Fail closed on an empty variant list. "I could not see this product's variants"
 * is not "the variant is fine" — and a product with no variants cannot be bought
 * anyway, so nothing legitimate is refused.
 */
export function isVariantOwnedByProduct(
  variantId: string,
  productVariants: ReadonlyArray<{ id: string }>,
): boolean {
  return productVariants.some((variant) => variant.id === variantId)
}
