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
  test('US is open while unknown markets stay structured unavailable', () => {
    const us = planMarketCatalogRead('us')
    expect(isMarketUnavailable(us)).toBe(false)
    if (isMarketUnavailable(us)) throw new Error('expected open US market')
    expect(us.query).toBe('market=us')

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

  test('US listings format USD in en-US and now offer buy_now on the S4 direct-charge rail', () => {
    const usListing = {
      ...LISTING,
      title: 'Hand-thrown mug',
      currency: 'USD',
      price_cents: 10_000,
      location: 'Brooklyn',
      state: 'New York',
      shop: {
        ...LISTING.shop,
        name: 'North Clay',
        slug: 'north-clay',
        location: 'Brooklyn',
        // Claimed: `buy_now` is `readiness.ready && isClaimed && inStock`, so an
        // unclaimed shop would hide the readiness change behind an unrelated false.
        clerk_user_id: 'user_north_clay',
        // The shape a real US seller persists — Accounts v2 (D14), which has NO
        // `connected`/`charges_enabled` keys. Written out in full rather than
        // simplified, because "the storefront only understood the v1 shape" is
        // exactly the bug this fixture exists to catch.
        metadata: {
          settings: {
            stripe: {
              account_id: 'acct_us',
              api_generation: 'v2',
              account_country: 'us',
              merchant_configuration: 'active',
              card_payments_status: 'active',
              blocking_requirements: [],
              outstanding_requirements: [],
            },
          },
        },
      },
    } as Listing
    const item = toUcpListing(usListing, 'https://miyagisanchez.com', null, false, 'us')
    expect(item.market_code).toBe('us')
    expect(item.price?.currency).toBe('USD')
    expect(item.price?.formatted).toMatch(/^\$/)
    expect(item.url).toBe('https://miyagisanchez.com/us/l/prod_123')
    expect(item.actions.buy_now).toBe(true)
    expect(item.commerce_readiness).toEqual({ ready: true, market_code: 'us', reason: 'ready' })
    // NO per-listing checkout URL for US, deliberately. `/api/stripe/checkout` and
    // `/api/mp/checkout` are the legacy Mexican rails — the first refuses any non-MXN
    // listing with MARKET_NOT_SUPPORTED and MercadoPago cannot settle USD at all.
    // Advertising one would hand an agent `buy_now: true` beside a URL guaranteed to
    // refuse, which is worse than no URL: the agent cannot tell until it tries to pay.
    // US agent checkout goes through the market-aware /api/ucp/checkout-session.
    expect(item.checkout_urls).toEqual({})
  })

  test('MX keeps its per-listing legacy rails — the market scoping is not a blanket removal', () => {
    // Always allow the negation of what you ban: scoping the legacy rails to MX must
    // not quietly take them away from MX, which is where they actually work.
    const mx = toUcpListing(
      { ...LISTING, shop: { ...LISTING.shop, clerk_user_id: 'user_mx', metadata: { settings: { stripe: { connected: true, charges_enabled: true } } } } } as Listing,
      'https://miyagisanchez.com', null, false, 'mx',
    )
    expect(mx.actions.buy_now).toBe(true)
    expect(mx.checkout_urls?.stripe).toBe('https://miyagisanchez.com/api/stripe/checkout')
  })

  test('a US listing whose shop has no connected Stripe account still suppresses buy_now', () => {
    // The rail existing must not become a blanket yes. This is the case the S3 spec
    // used to cover for every US listing, and it still has to hold for this one.
    const unconnected = {
      ...LISTING,
      currency: 'USD',
      price_cents: 10_000,
      shop: { ...LISTING.shop, slug: 'north-clay', clerk_user_id: 'user_north_clay', metadata: {} },
    } as Listing
    const item = toUcpListing(unconnected, 'https://miyagisanchez.com', null, false, 'us')
    expect(item.actions.buy_now).toBe(false)
    expect(item.commerce_readiness).toMatchObject({ ready: false, market_code: 'us' })
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
    expect(shopHandler).toContain('marketMedusaHeaders(marketDecision.market.code)')

    const offerTool = source.slice(
      source.indexOf("name: 'make_offer'"),
      source.indexOf("name: 'get_shop'"),
    )
    const offerHandler = source.slice(
      source.indexOf('async function handleMakeOffer'),
      source.indexOf('async function handleGetShop'),
    )
    expect(offerTool).toContain('market:')
    expect(offerHandler).toContain('planMarketCatalogRead(args.market)')
    expect(offerHandler).toContain('verifyMarketFilter(marketDecision.market, data)')

    for (const [toolName, nextTool] of [
      ['check_availability', 'book_appointment'],
      ['book_appointment', 'get_buyer_trust'],
    ]) {
      const tool = source.slice(
        source.indexOf(`name: '${toolName}'`),
        source.indexOf(`name: '${nextTool}'`),
      )
      expect(tool, toolName).toContain('market:')
    }
    for (const [handlerName, nextHandler] of [
      ['handleCheckAvailability', 'handleBookAppointment'],
      ['handleBookAppointment', 'handleGetBuyerTrust'],
    ]) {
      const handler = source.slice(
        source.indexOf(`async function ${handlerName}`),
        source.indexOf(`async function ${nextHandler}`),
      )
      expect(handler, handlerName).toContain('planMarketCatalogRead(args.market)')
      expect(handler, handlerName).toContain('marketDecision.market.code')
    }
    const schedulingReaders = source.slice(
      source.indexOf('async function getShopCalcom'),
      source.indexOf('async function handleGetBuyerTrust'),
    )
    expect(schedulingReaders).toContain('?market=${marketCode}')
    expect(schedulingReaders).toContain('verifyMarketFilter(MARKETS[marketCode], data)')

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
