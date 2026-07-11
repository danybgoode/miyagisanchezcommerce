import { test, expect } from '@playwright/test'
import {
  shopifyProductToIncomingSupplyItem,
  shopifyCategoryToMiyagi,
  shopifyConditionToMiyagi,
  type ShopifyUcpProduct,
} from '../lib/shopify-import'
import { isPublicDomainShape, isPrivateIpv4, isPrivateIpv6 } from '../lib/ssrf-guard'

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

// ── SSRF hardening (cross-review finding, 2026-07-11) ───────────────────────
// `shop_domain` is untrusted, server-fetched input. `isPublicDomainShape` is
// only the friendly early-reject; the real boundary is the DNS-resolve +
// private-range check in `assertPublicHost` (not unit-testable without
// network) — these specs cover the pure pieces: domain shape, and the
// IPv4/IPv6 private/reserved-range classifiers that boundary relies on.
test.describe('shopify-mcp-client · isPublicDomainShape', () => {
  test('accepts ordinary public-looking domains', () => {
    expect(isPublicDomainShape('mitienda.com')).toBe(true)
    expect(isPublicDomainShape('mitienda.myshopify.com')).toBe(true)
    expect(isPublicDomainShape('https://mitienda.com/')).toBe(true) // protocol/path stripped
  })
  test('rejects empty, localhost, bare IPs, and IPv6/port literals', () => {
    expect(isPublicDomainShape('')).toBe(false)
    expect(isPublicDomainShape('localhost')).toBe(false)
    expect(isPublicDomainShape('printer.local')).toBe(false)
    expect(isPublicDomainShape('127.0.0.1')).toBe(false)
    expect(isPublicDomainShape('10.0.0.5')).toBe(false)
    expect(isPublicDomainShape('mitienda.com:8080')).toBe(false)
    expect(isPublicDomainShape('::1')).toBe(false)
  })
})

test.describe('shopify-mcp-client · isPrivateIpv4 (the DNS-rebinding guard)', () => {
  test('flags every private/reserved/loopback range', () => {
    expect(isPrivateIpv4('10.1.2.3')).toBe(true)
    expect(isPrivateIpv4('172.16.0.1')).toBe(true)
    expect(isPrivateIpv4('172.31.255.255')).toBe(true)
    expect(isPrivateIpv4('192.168.1.1')).toBe(true)
    expect(isPrivateIpv4('127.0.0.1')).toBe(true)
    expect(isPrivateIpv4('169.254.1.1')).toBe(true) // link-local (cloud metadata endpoints live here)
    expect(isPrivateIpv4('100.64.0.1')).toBe(true) // CGNAT
    expect(isPrivateIpv4('0.0.0.0')).toBe(true)
    expect(isPrivateIpv4('224.0.0.1')).toBe(true) // multicast+
  })
  test('a genuinely public address is not flagged', () => {
    expect(isPrivateIpv4('93.184.216.34')).toBe(false) // example.com's real IP
    expect(isPrivateIpv4('172.15.255.255')).toBe(false) // just outside 172.16/12
    expect(isPrivateIpv4('172.32.0.0')).toBe(false) // just outside 172.16/12
  })
  test('malformed input fails closed (treated as private)', () => {
    expect(isPrivateIpv4('not-an-ip')).toBe(true)
    expect(isPrivateIpv4('999.999.999.999')).toBe(true)
  })
})

test.describe('shopify-mcp-client · isPrivateIpv6', () => {
  test('flags loopback, unique-local, and link-local', () => {
    expect(isPrivateIpv6('::1')).toBe(true)
    expect(isPrivateIpv6('::')).toBe(true)
    expect(isPrivateIpv6('fd00::1')).toBe(true) // unique local (fc00::/7)
    expect(isPrivateIpv6('fe80::1')).toBe(true) // link-local
  })
  test('unwraps an IPv4-mapped address and checks the IPv4 rules', () => {
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIpv6('::ffff:93.184.216.34')).toBe(false)
  })
  test('a genuinely public IPv6 address is not flagged', () => {
    expect(isPrivateIpv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false) // example.com
  })
})
