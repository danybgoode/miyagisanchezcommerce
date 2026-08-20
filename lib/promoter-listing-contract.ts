/**
 * Normalize the close-listing price and inventory contract at its one shared
 * boundary. `price_mxn` is retained for the established promoter workspace;
 * currency-aware callers use `price` + `currency`.
 */
export function normalizePromoterListingContract(input?: {
  price_mxn?: number
  price?: number
  currency?: 'MXN' | 'USD'
  quantity?: number
} | null) {
  const safeInput = input ?? {}
  const hasGenericPrice = typeof safeInput.price === 'number'
  // `price_mxn` is a legacy field whose name is its currency contract. Only the
  // new generic price field may opt into USD, so an old caller can never be
  // silently re-priced by an incidental new `currency` property.
  const currency: 'MXN' | 'USD' = hasGenericPrice && safeInput.currency === 'USD' ? 'USD' : 'MXN'
  const rawPrice = hasGenericPrice ? safeInput.price : safeInput.price_mxn
  const priceCents = typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0
    ? Math.round(rawPrice * 100)
    : null
  const quantity = typeof safeInput.quantity === 'number' && Number.isFinite(safeInput.quantity) && safeInput.quantity >= 0
    ? Math.floor(safeInput.quantity)
    : 1

  return { currency, priceCents, quantity }
}

/** Never let optional catalog decoration turn an authenticated write into a 500. */
export function optionalTrimmedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
