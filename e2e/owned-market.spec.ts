import { expect, test } from '@playwright/test'
import { MARKETS } from '../lib/markets'
import {
  readOwnedPriceGridPayload,
  readPublicSellerMarket,
  resolveOwnedPriceGridForPdp,
  selectBaseSellerPrice,
  type OwnedShopPriceGridResult,
} from '../lib/owned-market'

function sellerFor(code: 'mx' | 'us') {
  const market = MARKETS[code]
  return {
    slug: `seller-${code}`,
    market_code: market.code,
    country_code: market.country_code,
    currency_code: market.currency_code,
    marketplace_status: market.marketplace_status,
  }
}

test.describe('owned shop market projection', () => {
  test('accepts the complete sanitized MX and US projections', () => {
    expect(readPublicSellerMarket(sellerFor('mx'))?.market).toEqual(MARKETS.mx)
    expect(readPublicSellerMarket(sellerFor('us'))?.market).toEqual(MARKETS.us)
  })

  test('raw metadata is not the public market contract', () => {
    expect(readPublicSellerMarket({
      metadata: { operating_market: 'us' },
    })).toBeNull()
  })

  test('missing or contradictory projection fields fail closed', () => {
    const valid = sellerFor('us')
    expect(readPublicSellerMarket({ ...valid, market_code: undefined })).toBeNull()
    expect(readPublicSellerMarket({ ...valid, currency_code: 'mxn' })).toBeNull()
    expect(readPublicSellerMarket({ ...valid, country_code: 'mx' })).toBeNull()
    // Must stay the NEGATION of the registry's current US status: the guard rejects a
    // projection that disagrees with the registry, whichever way the disagreement runs.
    expect(MARKETS.us.marketplace_status).toBe('active')
    expect(readPublicSellerMarket({ ...valid, marketplace_status: 'invitation' })).toBeNull()
    expect(readPublicSellerMarket({ ...valid, market_code: 'US' })).toBeNull()
  })
})

test.describe('owned shop display price selection', () => {
  const prices = [
    { amount: 8_000, currency_code: 'mxn', min_quantity: 1 },
    { amount: 2_500, currency_code: 'usd', min_quantity: 10 },
    { amount: 3_000, currency_code: 'usd', min_quantity: 1 },
  ]

  test('US selects the USD base tier even when an MXN amount is numerically lower', () => {
    expect(selectBaseSellerPrice(prices, 'usd')).toEqual({
      amount: 3_000,
      currency_code: 'usd',
      min_quantity: 1,
    })
  })

  test('MX selects MXN independently', () => {
    expect(selectBaseSellerPrice(prices, 'mxn')).toEqual({
      amount: 8_000,
      currency_code: 'mxn',
      min_quantity: 1,
    })
  })

  test('a missing market-currency price has no different-currency fallback', () => {
    expect(selectBaseSellerPrice([
      { amount: 8_000, currency_code: 'mxn', min_quantity: 1 },
    ], 'usd')).toBeNull()
  })

  test('malformed amounts are ignored', () => {
    expect(selectBaseSellerPrice([
      { amount: Number.NaN, currency_code: 'usd', min_quantity: 1 },
      { amount: 1_000, currency_code: 'usd', min_quantity: 1 },
    ], 'usd')?.amount).toBe(1_000)
  })
})

test.describe('owned shop PDP price-grid contract', () => {
  const FLAT_GRID = {
    product_id: 'prod_flat',
    variants: [{
      id: 'variant_flat',
      options: { Presentación: 'Única' },
      manage_inventory: false,
      tiers: [{ min_quantity: 1, max_quantity: null, amount: 3_000 }],
    }],
  }

  test('a validated non-configurable flat grid remains a successful tenant read', () => {
    const result = readOwnedPriceGridPayload({
      market_code: 'mx',
      price_grid: FLAT_GRID,
    }, 'prod_flat')

    expect(result).toEqual({
      status: 'valid',
      market_code: 'mx',
      price_grid: FLAT_GRID,
    })
    expect(resolveOwnedPriceGridForPdp(result, 'mx')).toEqual(FLAT_GRID)
  })

  test('malformed, empty, and wrong-product grids are invalid — never flat-product success', () => {
    for (const payload of [
      null,
      { market_code: 'mx', price_grid: null },
      { market_code: 'mx', price_grid: { product_id: 'prod_flat', variants: [] } },
      { market_code: 'mx', price_grid: { ...FLAT_GRID, product_id: 'prod_other' } },
      {
        market_code: 'mx',
        price_grid: {
          ...FLAT_GRID,
          variants: [...FLAT_GRID.variants, { id: 'broken', options: {}, manage_inventory: false, tiers: [] }],
        },
      },
      {
        market_code: 'mx',
        price_grid: {
          ...FLAT_GRID,
          variants: [{
            ...FLAT_GRID.variants[0],
            tiers: [{ min_quantity: 1, max_quantity: null, amount: '3000' }],
          }],
        },
      },
      { market_code: 'MX', price_grid: FLAT_GRID },
    ]) {
      expect(readOwnedPriceGridPayload(payload, 'prod_flat')).toEqual({ status: 'invalid' })
    }
  })

  test('every non-valid read and a seller-market mismatch refuse the tenant PDP grid', () => {
    const unavailable: OwnedShopPriceGridResult = { status: 'unavailable', http_status: 503 }
    const invalid: OwnedShopPriceGridResult = { status: 'invalid' }
    const error: OwnedShopPriceGridResult = { status: 'error' }
    const wrongMarket = readOwnedPriceGridPayload({
      market_code: 'us',
      price_grid: FLAT_GRID,
    }, 'prod_flat')

    expect(resolveOwnedPriceGridForPdp(unavailable, 'mx')).toBeNull()
    expect(resolveOwnedPriceGridForPdp(invalid, 'mx')).toBeNull()
    expect(resolveOwnedPriceGridForPdp(error, 'mx')).toBeNull()
    expect(resolveOwnedPriceGridForPdp(wrongMarket, 'mx')).toBeNull()
  })
})
