import { test, expect } from '@playwright/test'
import {
  shopifyProductToIncomingSupplyItem,
  shopifyCategoryToMiyagi,
  shopifyConditionToMiyagi,
  type ShopifyUcpProduct,
} from '../lib/shopify-import'

/**
 * Shopify connector · Sprint 1 (epic 03 · platform-migrations).
 *
 * Fixtures mirror the REAL response shape confirmed by a live probe against
 * allbirds.com's `/api/ucp/mcp` `search_catalog` on 2026-07-11 (see
 * lib/shopify-mcp-client.ts header) — not a guessed/doc-summary shape.
 * The actual fetch/stage/import live in the Next.js route + Medusa internal
 * route (writes, unreachable from the `api` runner), so this gate covers what
 * the frontend owns deterministically: the pure Shopify→supply mapping incl.
 * graceful degradation, and the connector routes' flag/auth gating. The real
 * live-Shopify-domain pull + parity-report eyeball is owed to Daniel. See
 * sprint-1.md.
 */

function makeProduct(overrides: Partial<ShopifyUcpProduct> = {}): ShopifyUcpProduct {
  return {
    id: 'gid://shopify/Product/4826199687248',
    handle: 'womens-wool-runners-true-black',
    title: "Women's Wool Runner - True Black",
    description: { html: '<p>The original wool sneaker. <strong>Breathable</strong> and machine washable.</p>' },
    url: 'https://www.allbirds.com/products/womens-wool-runners-true-black',
    price_range: { min: { amount: 11000, currency: 'USD' }, max: { amount: 11000, currency: 'USD' } },
    media: [{ type: 'image', url: 'https://cdn.shopify.com/a.png' }],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/32956152938576',
        sku: 'WR3WTBK050',
        title: '5',
        price: { amount: 11000, currency: 'USD' },
        availability: { available: true },
        options: [{ name: 'Size', label: '5' }],
        media: [{ type: 'image', url: 'https://cdn.shopify.com/b.png' }],
      },
      {
        id: 'gid://shopify/ProductVariant/32956152971344',
        sku: 'WR3WTBK060',
        title: '6',
        price: { amount: 11000, currency: 'USD' },
        availability: { available: false },
        options: [{ name: 'Size', label: '6' }],
        media: [{ type: 'image', url: 'https://cdn.shopify.com/a.png' }], // dup of product-level image
      },
    ],
    ...overrides,
  }
}

test.describe('shopify-import · shopifyProductToIncomingSupplyItem', () => {
  test('maps a full product into the supply shape', () => {
    const out = shopifyProductToIncomingSupplyItem(makeProduct())
    expect(out.source_id).toBe('gid://shopify/Product/4826199687248')
    expect(out.source_url).toBe('https://www.allbirds.com/products/womens-wool-runners-true-black')
    expect(out.listing_title).toBe("Women's Wool Runner - True Black")
    expect(out.listing_description).toBe('The original wool sneaker. Breathable and machine washable.')
    expect(out.currency).toBe('USD')
    expect(out.listing_type).toBe('product')
    expect(out.category).toBe('otros')
    expect(out.condition).toBe('new')
    expect(out.price_cents).toBe(11000) // already minor units — no pesos/cents heuristic
    // Images are deduped across product + variant media pools.
    expect(out.images).toEqual([
      { url: 'https://cdn.shopify.com/a.png' },
      { url: 'https://cdn.shopify.com/b.png' },
    ])
    expect(out.metadata).toMatchObject({
      shopify_product_id: 'gid://shopify/Product/4826199687248',
      shopify_handle: 'womens-wool-runners-true-black',
      shopify_variant_count: 2,
      shopify_available: true, // at least one variant available
    })
  })

  test('falls back to variant price when price_range is absent', () => {
    const out = shopifyProductToIncomingSupplyItem(makeProduct({ price_range: null }))
    expect(out.price_cents).toBe(11000)
    expect(out.currency).toBe('USD')
  })

  test('marks unavailable when every variant is unavailable', () => {
    const product = makeProduct({
      variants: [
        { id: 'v1', price: { amount: 100, currency: 'USD' }, availability: { available: false } },
      ],
    })
    const out = shopifyProductToIncomingSupplyItem(product)
    expect(out.metadata).toMatchObject({ shopify_available: false })
  })

  test('degrades missing/odd fields gracefully (no throw, no broken product)', () => {
    const out = shopifyProductToIncomingSupplyItem({
      id: null,
      handle: 'no-title',
      title: '',
      description: null,
      url: null,
      price_range: null,
      media: null,
      variants: [],
    })
    expect(out.source_id).toBe('no-title') // falls back to handle
    expect(out.listing_title).toBeUndefined()
    expect(out.listing_description).toBeUndefined()
    expect(out.price_cents).toBeUndefined()
    expect(out.images).toEqual([])
    expect(out.category).toBe('otros')
    expect(out.condition).toBe('new')
    expect(out.currency).toBe('MXN') // default when no money anywhere
  })

  test('extracts plain text from an HTML description, and prefers `plain` when present', () => {
    const htmlOnly = shopifyProductToIncomingSupplyItem(
      makeProduct({ description: { html: '<p>Line one.</p><p>Line two.</p>' } }),
    )
    expect(htmlOnly.listing_description).toBe('Line one. Line two.')

    const withPlain = shopifyProductToIncomingSupplyItem(
      makeProduct({ description: { html: '<p>ignored</p>', plain: 'Plain wins.' } }),
    )
    expect(withPlain.listing_description).toBe('Plain wins.')
  })
})

test.describe('shopify-import · category/condition fallbacks', () => {
  test('every product maps to otros/new (no Miyagi-shaped taxonomy in Shopify UCP catalog)', () => {
    expect(shopifyCategoryToMiyagi()).toBe('otros')
    expect(shopifyConditionToMiyagi()).toBe('new')
  })
})

// ── Connector routes are flag-gated + auth-gated ───────────────────────────
test.describe('shopify import routes · gating', () => {
  test('POST /api/sell/shopify/import/fetch → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/shopify/import/fetch', { data: { shop_domain: 'example.com' } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/shopify/import → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/shopify/import', { data: { batchId: 'x', itemIds: ['a'] } })
    expect(res.status()).toBe(401)
  })
})
