import { test, expect } from '@playwright/test'
import {
  normalizeSupplyItem,
  supplyItemToSellerBody,
  supplyItemToProductBody,
  type SupplyItem,
} from '../lib/supply'
import { describeMedusaNetworkFailure, getMedusaInternalBaseUrl, probeMedusaInternal } from '../lib/medusa-internal'

/**
 * Gem → Claimable Shop Loop · Sprint 1+2.
 *
 * Pure mapper coverage for the supply→Medusa import hop, plus the secret
 * gates on the new endpoints (all negative-path, prod-safe). The full import
 * happy path needs the Medusa internal routes + Supabase, so it's covered by
 * the post-merge live smoke (sprint-3.md), not here.
 */

function gemItem(overrides: Partial<SupplyItem> = {}): SupplyItem {
  return {
    id: 'item-1',
    batch_id: 'batch-1',
    status: 'approved',
    quality_score: 7,
    duplicate_key: null,
    source_platform: 'manual',
    source_url: 'https://maps.google.com/?cid=123',
    source_id: null,
    shop_name: 'Pulquería Las Duelistas',
    shop_slug: 'pulqueria-las-duelistas',
    shop_source_url: 'https://instagram.com/lasduelistas',
    shop_description: 'Pulques curados en la Roma',
    shop_location: 'Roma Norte, CDMX',
    shop_logo_url: null,
    shop_metadata: {},
    listing_title: 'Pulque curado artesanal',
    listing_description: 'Curados de temporada',
    price_cents: 9000,
    currency: 'MXN',
    condition: 'new',
    listing_type: 'service',
    category: 'servicios',
    state: 'Ciudad de México',
    municipio: 'Cuauhtémoc',
    location: 'Roma Norte, CDMX',
    images: [{ url: 'https://example.com/duelistas.jpg', alt: 'fachada' }],
    tags: ['pulque'],
    listing_metadata: { phone: '+52555' },
    raw_data: {},
    error_message: null,
    imported_shop_id: null,
    imported_listing_id: null,
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    imported_at: null,
    ...overrides,
  }
}

test.describe('supplyItemToSellerBody — unclaimed Medusa seller payload', () => {
  test('maps shop fields + supply provenance', () => {
    const body = supplyItemToSellerBody(gemItem())
    expect(body.name).toBe('Pulquería Las Duelistas')
    expect(body.slug).toBe('pulqueria-las-duelistas')
    expect(body.source).toBe('scraped')
    // Shop provenance prefers the shop's own URL over the listing's.
    expect(body.source_url).toBe('https://instagram.com/lasduelistas')
    expect(body.location).toBe('Roma Norte, CDMX')
    expect((body.metadata.supply as Record<string, unknown>).unclaimed).toBe(true)
  })

  test('preserves an explicit operating market from CSV staging through the Medusa seller seam', () => {
    const staged = normalizeSupplyItem({
      source_url: 'https://example.com/products/hat',
      title: 'Hat',
      shop_name: 'US Shop',
      operating_market: ' US ',
    }, { source_platform: 'shopify' })
    const body = supplyItemToSellerBody(gemItem({ shop_metadata: staged.shop_metadata }))

    expect(staged.shop_metadata).toEqual({ operating_market: 'us' })
    expect(body.operating_market).toBe('us')
  })

  test('omits operating market when the CSV does, preserving the backend MX default', () => {
    const body = supplyItemToSellerBody(gemItem())
    expect(body.operating_market).toBeUndefined()

    const staged = normalizeSupplyItem({ operating_market: '   ' }, { source_platform: 'csv' })
    expect(staged.shop_metadata).toEqual({})
  })

  test('falls back to listing source_url and a default name', () => {
    const body = supplyItemToSellerBody(gemItem({ shop_name: null, shop_slug: null, shop_source_url: null }))
    expect(body.name).toBe('Vendedor sin reclamar')
    expect(body.slug).toBeUndefined()
    expect(body.source_url).toBe('https://maps.google.com/?cid=123')
  })
})

test.describe('internal Medusa import diagnostics', () => {
  test('uses the server-only endpoint and records a safe network cause', () => {
    expect(getMedusaInternalBaseUrl({ MEDUSA_STORE_URL: 'https://api.example.com///' })).toBe('https://api.example.com')
    expect(getMedusaInternalBaseUrl({})).toBe('http://localhost:9000')

    const error = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    expect(describeMedusaNetworkFailure('Seller create', 'https://api.example.com', error))
      .toBe('Seller create network failure to api.example.com: fetch failed (ECONNREFUSED)')
  })

  test('treats a reserved-slug 404 as an authenticated, non-mutating readiness success', async () => {
    const result = await probeMedusaInternal('internal-secret', {
      baseUrl: 'https://api.example.com',
      fetchImpl: async () => new Response(null, { status: 404 }),
    })

    expect(result).toEqual({
      reachable: true,
      authorized: true,
      status: 404,
      endpoint: 'api.example.com',
      error: null,
    })
  })
})

test.describe('supplyItemToProductBody — Medusa product payload', () => {
  test('maps listing fields, status and provenance metadata', () => {
    const body = supplyItemToProductBody(gemItem(), 'pulqueria-las-duelistas', 'active')
    expect(body.seller_slug).toBe('pulqueria-las-duelistas')
    expect(body.handle).toBe('pulqueria-las-duelistas-pulque-curado-artesanal-item-1')
    expect(body.title).toBe('Pulque curado artesanal')
    expect(body.price_cents).toBe(9000)
    expect(body.category).toBe('servicios')
    expect(body.listing_type).toBe('service')
    expect(body.state).toBe('Ciudad de México')
    expect(body.municipio).toBe('Cuauhtémoc')
    // Legacy batch target 'active' → Medusa 'published'.
    expect(body.status).toBe('published')
    expect(body.images).toEqual([{ url: 'https://example.com/duelistas.jpg', alt: 'fachada' }])
    expect(body.metadata.original_source_url).toBe('https://maps.google.com/?cid=123')
    expect(body.metadata.source_platform).toBe('manual')
    // PDP source link + custom metadata both survive.
    expect(body.metadata.source_url).toBe('https://maps.google.com/?cid=123')
    expect(body.metadata.phone).toBe('+52555')
    expect((body.metadata.supply as Record<string, unknown>).unclaimed_shop).toBe(true)
  })

  test('condition only applies to product listings; draft target stays draft', () => {
    const service = supplyItemToProductBody(gemItem(), 's', 'active')
    expect(service.condition).toBeNull()
    const product = supplyItemToProductBody(gemItem({ listing_type: 'product' }), 's', 'draft')
    expect(product.condition).toBe('new')
    expect(product.status).toBe('draft')
  })

  test('title is trimmed and capped at 100 chars', () => {
    const body = supplyItemToProductBody(gemItem({ listing_title: `  ${'x'.repeat(140)}  ` }), 's', 'active')
    expect(body.title).toHaveLength(100)
    expect(body.handle).toMatch(/^s-x+-item-1$/)
    expect(body.handle.length).toBeLessThanOrEqual(100)
  })
})

test.describe('new supply/claim endpoints are secret-gated', () => {
  test('POST /api/supply/upload without secret → 401', async ({ request }) => {
    const res = await request.post('/api/supply/upload')
    expect(res.status()).toBe(401)
  })

  test('POST /api/supply/import without secret → 401', async ({ request }) => {
    const res = await request.post('/api/supply/import', { data: { batchId: 'x' } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/claim/complete without shared secret → 401', async ({ request }) => {
    const res = await request.post('/api/claim/complete', {
      data: { token: 'not-a-token', clerk_user_id: 'user_x' },
    })
    expect(res.status()).toBe(401)
  })
})
