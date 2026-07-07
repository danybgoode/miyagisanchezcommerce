/**
 * "Volver a pedir" — custom-print-products epic, Sprint 4 · Story 4.3.
 *
 * Pure derivation of WHICH item to reorder and where to send the buyer.
 * Reuses the buy box's own hand-off (`/checkout?listingId=&variantId=&qty=`
 * + `stashPersonalization`) instead of calling `startCheckout` directly —
 * the buyer picks a payment method fresh at checkout rather than silently
 * re-charging whatever the original order used, and the price always
 * re-resolves at TODAY's tiers there. No new tables, no new checkout path.
 */

import { formatPriceGridAmount } from './price-grid'

export interface ReorderLineItem {
  product_id: string | null
  variant_id: string | null
  quantity: number
  unit_price_cents: number
  personalization: unknown
}

export interface ReorderTarget {
  listingId: string
  variantId: string
  quantity: number
}

/**
 * The first order item, narrowed to a reorderable target — null when the
 * order has no items, or its item has no real variant_id (a legacy/plain
 * order predates the configurator and can't be replayed this way).
 */
export function resolveReorderTarget(lineItems: ReorderLineItem[] | null | undefined): ReorderTarget | null {
  const item = (lineItems ?? [])[0]
  if (!item?.product_id || !item?.variant_id) return null
  return {
    listingId: item.product_id,
    variantId: item.variant_id,
    quantity: Math.max(1, Math.floor(item.quantity) || 1),
  }
}

/** The checkout URL the buy box itself navigates to for this variant/qty. */
export function buildReorderCheckoutPath(target: ReorderTarget): string {
  return `/checkout?listingId=${encodeURIComponent(target.listingId)}&variantId=${encodeURIComponent(target.variantId)}&qty=${target.quantity}`
}

/**
 * A one-line disclosure when the live tier price differs from what the
 * original order charged — null when unresolvable or unchanged, so the
 * caller shows nothing rather than a confusing "updated" note for an
 * identical price.
 */
export function reorderPriceChangeNote(
  originalUnitCents: number,
  currentUnitCents: number | null,
  quantity: number,
  currency: string,
): string | null {
  if (currentUnitCents == null || currentUnitCents === originalUnitCents) return null
  return `Precio actualizado: ${formatPriceGridAmount(currentUnitCents * quantity, currency)}.`
}
