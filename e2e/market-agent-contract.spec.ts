import { test, expect } from '@playwright/test'
import { isMarketUnavailable, planMarketCatalogRead } from '../lib/market-catalog'
import { toUcpListing } from '../lib/ucp/schema'
import type { Listing } from '../lib/types'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

  test('checkout discovery refuses a closed market before reading the mirror', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/checkout-session/route.ts'), 'utf8')
    const post = source.slice(source.indexOf('export async function POST'))
    const planAt = post.indexOf('planMarketCatalogRead')
    const mirrorAt = post.indexOf(".from('marketplace_listings')")
    expect(planAt).toBeGreaterThan(-1)
    expect(mirrorAt).toBeGreaterThan(-1)
    expect(planAt).toBeLessThan(mirrorAt)
    expect(post).toContain('getListing(medusaListingId, marketDecision.market.code)')
  })

  test('checkout commercial facts come from the market-scoped Medusa listing, not the mirror', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/checkout-session/route.ts'), 'utf8')
    const post = source.slice(source.indexOf('export async function POST'))
    expect(post).toContain('const mirrorListingId = rawListing.id')
    expect(post).toContain('const listing = { ...marketListing, shop } as Listing')
    expect(post).toContain('const publicListingId = listing.medusa_product_id ?? listing.id')
    expect(post).not.toContain('const listing = { ...rawListing, shop } as Listing')
    expect(post).toContain(".eq('listing_id', mirrorListingId)")
    expect(post).not.toContain(".eq('status', 'active')")
    expect(post).toContain('listing_id:         publicListingId')
  })

  test('buyer catalog and checkout tools expose and thread the selected market', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    const optionsTool = source.slice(
      source.indexOf("name: 'get_checkout_options'"),
      source.indexOf("name: 'create_checkout'"),
    )
    const createTool = source.slice(
      source.indexOf("name: 'create_checkout'"),
      source.indexOf("name: 'get_support_options'"),
    )
    expect(optionsTool).toContain("market:")
    expect(createTool).toContain("market:")

    const optionsHandler = source.slice(
      source.indexOf('async function handleGetCheckoutOptions'),
      source.indexOf('async function handleCreateCheckout'),
    )
    const createHandler = source.slice(
      source.indexOf('async function handleCreateCheckout'),
      source.indexOf('const ARTWORK_DOWNLOAD_ERROR'),
    )
    expect(optionsHandler).toContain('planMarketCatalogRead(args.market)')
    expect(optionsHandler).toContain('market: marketDecision.market.code')
    expect(createHandler).toContain('planMarketCatalogRead(args.market)')
    expect(createHandler).toContain('/api/ucp/checkout-session')
    expect(createHandler).toContain('market: marketDecision.market.code')

    const shopTool = source.slice(
      source.indexOf("name: 'get_shop'"),
      source.indexOf("name: 'check_availability'"),
    )
    const shopHandler = source.slice(
      source.indexOf('async function handleGetShop'),
      source.indexOf('async function getShopCalcom'),
    )
    expect(shopTool).toContain('market:')
    expect(shopHandler).toContain('planMarketCatalogRead(args.market)')
    expect(shopHandler).toContain("params.set('market', marketDecision.market.code)")
    expect(shopHandler).toContain('verifyMarketFilter(marketDecision.market, data)')
    expect(shopHandler).toContain('marketDecision.market.code')

    const pulseTool = source.slice(
      source.indexOf("name: 'get_neighborhood_pulse'"),
      source.indexOf("name: 'get_listing'"),
    )
    const pulseHandler = source.slice(
      source.indexOf('async function handleGetNeighborhoodPulse'),
      source.indexOf('async function handleGetListing'),
    )
    expect(pulseTool).toContain('market:')
    expect(pulseHandler).toContain('planMarketCatalogRead(args.market)')
    expect(pulseHandler).toContain('marketDecision.market.code')

    const pulseRoute = readFileSync(join(ROOT, 'app/api/ucp/neighborhood-pulse/route.ts'), 'utf8')
    expect(pulseRoute).toContain("planMarketCatalogRead(searchParams.get('market'))")
    expect(pulseRoute).toContain('marketDecision.market.code')
  })
})
