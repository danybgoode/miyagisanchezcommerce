import { DEFAULT_MARKET, isMarketCode, MARKETS } from './markets'

/** The persisted seller market owns product and Stripe currency. */
export function sellerListingCurrency(metadata: Record<string, unknown> | null | undefined): string | null {
  const persisted = metadata?.operating_market
  if (persisted != null && !isMarketCode(persisted)) return null
  const market = isMarketCode(persisted) ? persisted : DEFAULT_MARKET
  return MARKETS[market].currency_code.toUpperCase()
}
