import { test, expect } from '@playwright/test'
import { isMarketUnavailable, planMarketCatalogRead } from '../lib/market-catalog'
import { toUcpListing } from '../lib/ucp/schema'
import type { Listing } from '../lib/types'

const LISTING = {
  id: 'prod_123',
  medusa_product_id: 'prod_123',
  shop_id: 'seller_123',
  title: 'Taza',
  description: null,
  price_cents: 10_000,
  currency: 'MXN',
  images: [],
  condition: 'new',
  listing_type: 'product',
  category: 'hogar',
  collections: [],
  location: 'CDMX',
  state: 'Ciudad de México',
  views: 0,
  created_at: '2026-07-29T00:00:00.000Z',
  in_stock: true,
  available_quantity: null,
  manage_inventory: false,
  allow_backorder: false,
  metadata: {},
  attrs: {},
  status: 'active',
  shop: {
    id: 'seller_123',
    name: 'Taller',
    slug: 'taller',
    verified: true,
    location: 'CDMX',
    metadata: {},
    clerk_user_id: 'user_123',
  },
} as unknown as Listing

test.describe('UCP/MCP country-market contract', () => {
  test('invitation and unknown markets are structured unavailable, never empty success', () => {
    const us = planMarketCatalogRead('us')
    expect(isMarketUnavailable(us)).toBe(true)
    if (!isMarketUnavailable(us)) throw new Error('expected unavailable')
    expect(us).toEqual({
      unavailable: true,
      market_code: 'us',
      marketplace_status: 'invitation',
      reason: 'marketplace_not_open',
    })

    const unknown = planMarketCatalogRead('es-MX')
    expect(isMarketUnavailable(unknown)).toBe(true)
    if (!isMarketUnavailable(unknown)) throw new Error('expected unavailable')
    expect(unknown.market_code).toBeNull()
    expect(unknown.reason).toBe('unknown_market')
  })

  test('every agent listing names its market and emits canonical platform URLs', () => {
    const item = toUcpListing(LISTING, 'https://miyagisanchez.com', null, false, 'mx')
    expect(item.market_code).toBe('mx')
    expect(item.url).toBe('https://miyagisanchez.com/mx/l/prod_123')
    expect(item.shop.url).toBe('https://miyagisanchez.com/mx/s/taller')
    expect(item.schema_org.url).toBe(item.url)
  })

  test('the temporary default is MX and remains explicit in the read plan', () => {
    const plan = planMarketCatalogRead()
    expect(isMarketUnavailable(plan)).toBe(false)
    if (isMarketUnavailable(plan)) throw new Error('expected open market')
    expect(plan.market.code).toBe('mx')
    expect(plan.query).toBe('market=mx')
  })
})
