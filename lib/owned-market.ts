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
import { readPriceGrid, type PriceGrid } from './price-grid'

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

/**
 * A tenant price-grid read keeps transport unavailability, malformed data, and a
 * valid backend contract distinct. In particular, `null` is never overloaded to
 * mean both "ordinary flat product" and "the owner endpoint could not be trusted":
 * a flat product still has one valid variant/base tier in Medusa's grid.
 */
export type OwnedShopPriceGridResult =
  | Readonly<{
      status: 'valid'
      price_grid: PriceGrid
      market_code: MarketCode
    }>
  | Readonly<{
      status: 'unavailable'
      http_status: number
    }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'error' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The general price-grid reader is intentionally forgiving for legacy marketplace
 * payloads. The new owned endpoint has an exact backend contract, so its money-path
 * boundary is strict: silently dropping one malformed variant/tier could expose a
 * different price or checkout choice than Medusa will charge.
 */
function isExactOwnedPriceGrid(value: unknown, expectedProductId: string): boolean {
  if (!isRecord(value) || value.product_id !== expectedProductId || !Array.isArray(value.variants)) {
    return false
  }
  if (value.variants.length === 0) return false

  return value.variants.every((variant) => {
    if (
      !isRecord(variant) ||
      typeof variant.id !== 'string' ||
      variant.id.length === 0 ||
      !isRecord(variant.options) ||
      !Object.values(variant.options).every((option) => typeof option === 'string') ||
      typeof variant.manage_inventory !== 'boolean' ||
      !Array.isArray(variant.tiers) ||
      variant.tiers.length === 0
    ) {
      return false
    }

    return variant.tiers.every((tier) => {
      if (!isRecord(tier)) return false
      const min = tier.min_quantity
      const max = tier.max_quantity
      const amount = tier.amount
      return (
        typeof min === 'number' &&
        Number.isInteger(min) &&
        min >= 1 &&
        (max === null || (
          typeof max === 'number' &&
          Number.isInteger(max) &&
          max >= min
        )) &&
        typeof amount === 'number' &&
        Number.isFinite(amount) &&
        amount > 0
      )
    })
  })
}

/** Validate the successful JSON body from the seller-owned price-grid endpoint. */
export function readOwnedPriceGridPayload(
  payload: unknown,
  expectedProductId: string,
): OwnedShopPriceGridResult {
  if (!payload || typeof payload !== 'object') return { status: 'invalid' }
  const body = payload as Record<string, unknown>
  if (!isMarketCode(body.market_code)) return { status: 'invalid' }
  if (!isExactOwnedPriceGrid(body.price_grid, expectedProductId)) return { status: 'invalid' }

  const grid = readPriceGrid({ price_grid: body.price_grid })
  if (
    !grid ||
    grid.product_id !== expectedProductId ||
    grid.variants.length === 0
  ) {
    return { status: 'invalid' }
  }

  return {
    status: 'valid',
    price_grid: grid,
    market_code: body.market_code,
  }
}

/**
 * Route-level authorization over the independently validated listing and grid.
 * Any non-valid read or seller/grid market disagreement refuses the tenant PDP.
 */
export function resolveOwnedPriceGridForPdp(
  result: unknown,
  sellerMarketCode: unknown,
): PriceGrid | null {
  if (!result || typeof result !== 'object') return null
  const read = result as Record<string, unknown>
  if (
    read.status !== 'valid' ||
    !isMarketCode(sellerMarketCode) ||
    read.market_code !== sellerMarketCode
  ) {
    return null
  }
  return readPriceGrid(read.price_grid)
}
