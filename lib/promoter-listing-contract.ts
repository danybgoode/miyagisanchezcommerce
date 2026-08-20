/**
 * Normalize the close-listing price and inventory contract at its one shared
 * boundary. `price_mxn` is retained for the established promoter workspace;
 * currency-aware callers use `price` + `currency`.
 */
export function normalizePromoterListingContract(input: {
  price_mxn?: number
  price?: number
  currency?: 'MXN' | 'USD'
  quantity?: number
}) {
  const currency: 'MXN' | 'USD' = input.currency === 'USD' ? 'USD' : 'MXN'
  const rawPrice = typeof input.price === 'number' ? input.price : input.price_mxn
  const priceCents = typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0
    ? Math.round(rawPrice * 100)
    : null
  const quantity = typeof input.quantity === 'number' && Number.isFinite(input.quantity) && input.quantity >= 0
    ? Math.floor(input.quantity)
    : 1

  return { currency, priceCents, quantity }
}
