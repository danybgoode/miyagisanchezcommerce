/**
 * Pure validation for the public seller market projection used by owned shops.
 *
 * The backend deliberately exposes these fields first-class and removes
 * `metadata.operating_market` from the public metadata bag. Frontend consumers
 * validate the complete projection against the registry before selecting prices:
 * a missing/contradictory market is unavailable, never an excuse to assume MXN.
 */
import {
  MARKETS,
  isMarketCode,
  type MarketCode,
  type MarketRecord,
  type MarketplaceStatus,
} from './markets'

export interface PublicSellerMarket {
  readonly market: MarketRecord
  readonly market_code: MarketCode
  readonly country_code: string
  readonly currency_code: string
  readonly marketplace_status: MarketplaceStatus
}

export function readPublicSellerMarket(value: unknown): PublicSellerMarket | null {
  if (!value || typeof value !== 'object') return null
  const seller = value as Record<string, unknown>
  const code = seller.market_code
  if (!isMarketCode(code)) return null

  const market = MARKETS[code]
  if (
    seller.country_code !== market.country_code ||
    seller.currency_code !== market.currency_code ||
    seller.marketplace_status !== market.marketplace_status
  ) {
    return null
  }

  return Object.freeze({
    market,
    market_code: market.code,
    country_code: market.country_code,
    currency_code: market.currency_code,
    marketplace_status: market.marketplace_status,
  })
}

export interface SellerPrice {
  readonly amount: number
  readonly currency_code: string
  readonly min_quantity?: number | null
}

/**
 * Select the quantity-one/base price in exactly the seller market's currency.
 * A different-currency price is not a fallback: that would display MX rails for a
 * US-owned shop (or vice versa) while claiming the seller's market.
 */
export function selectBaseSellerPrice(
  prices: readonly SellerPrice[] | null | undefined,
  currencyCode: string,
): SellerPrice | null {
  const matching = (prices ?? []).filter((price) =>
    Number.isFinite(price.amount) &&
    price.currency_code.toLowerCase() === currencyCode,
  )
  if (matching.length === 0) return null
  return matching.reduce((lowest, price) =>
    (price.min_quantity ?? 1) < (lowest.min_quantity ?? 1) ? price : lowest)
}
