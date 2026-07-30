import { expect, test } from '@playwright/test'
import { MARKETS } from '../lib/markets'
import { readPublicSellerMarket, selectBaseSellerPrice } from '../lib/owned-market'

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
    expect(readPublicSellerMarket({ ...valid, marketplace_status: 'active' })).toBeNull()
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
