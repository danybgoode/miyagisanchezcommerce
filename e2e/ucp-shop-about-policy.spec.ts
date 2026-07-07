import { test, expect } from '@playwright/test'
import { toUcpListing } from '../lib/ucp/schema'
import type { Listing, Shop } from '../lib/types'

/**
 * Own-shop premium presentation (epic 07, Sprint 3) — Story 3.2. The UCP
 * "shop payload" is the `shop: {...}` object embedded in every listing
 * response (`toUcpListing()`, lib/ucp/schema.ts) — this locks that it carries
 * `about` and `returns_policy` so an agent can ground "¿quién es esta tienda?"
 * / "¿cuál es su política de devoluciones?" from get_listing/search_listings,
 * without a new endpoint.
 */

function shop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop_1',
    slug: 'miyagiprints',
    name: 'Miyagi Prints',
    description: null,
    location: null,
    logo_url: null,
    clerk_user_id: 'user_1',
    verified: false,
    source: null,
    source_url: null,
    metadata: {},
    created_at: new Date().toISOString(),
    custom_domain: null,
    custom_domain_verified: false,
    custom_domain_vercel_ok: false,
    ...overrides,
  } as Shop
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'prod_ucp_shop_1',
    shop_id: 'shop_1',
    medusa_product_id: 'prod_ucp_shop_1',
    title: 'Anuncio de prueba',
    description: 'Descripción',
    price_cents: 150000,
    currency: 'MXN',
    condition: 'good',
    listing_type: 'product',
    category: 'otros',
    collections: [],
    state: 'Jalisco',
    municipio: 'Guadalajara',
    location: 'Guadalajara, Jalisco',
    attrs: {},
    metadata: {},
    images: [],
    tags: [],
    status: 'active',
    source_platform: null,
    source_url: null,
    views: 0,
    manage_inventory: false,
    available_quantity: null,
    in_stock: true,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Listing
}

test.describe('UCP shop payload — about + returns_policy (Sprint 3)', () => {
  test('a shop with about + returns_policy set carries both in the UCP shop payload', () => {
    const s = shop({
      metadata: {
        settings: {
          about: { body: 'Somos una tienda familiar en Monterrey.' },
          returns_policy: { window: '14d', conditions: 'original', shipping_paid_by: 'seller', custom_note: 'Escríbenos por WhatsApp.' },
        },
      },
    })
    const ucp = toUcpListing(listing({ shop: s }), 'https://miyagisanchez.com')
    expect(ucp.shop.about).toBe('Somos una tienda familiar en Monterrey.')
    expect(ucp.shop.returns_policy).toEqual({
      window: '14d', conditions: 'original', shipping_paid_by: 'seller', custom_note: 'Escríbenos por WhatsApp.',
    })
  })

  test('a shop with neither configured carries null for both (never a dead field)', () => {
    const s = shop({ metadata: { settings: {} } })
    const ucp = toUcpListing(listing({ shop: s }), 'https://miyagisanchez.com')
    expect(ucp.shop.about).toBeNull()
    expect(ucp.shop.returns_policy).toBeNull()
  })

  test('an empty/whitespace-only about body is treated as unauthored (null)', () => {
    const s = shop({ metadata: { settings: { about: { body: '   ' } } } })
    const ucp = toUcpListing(listing({ shop: s }), 'https://miyagisanchez.com')
    expect(ucp.shop.about).toBeNull()
  })

  test('a returns_policy with no window is treated as unset (null) — "none" never surfaces as a positive signal', () => {
    const s = shop({ metadata: { settings: { returns_policy: { conditions: 'original' } } } })
    const ucp = toUcpListing(listing({ shop: s }), 'https://miyagisanchez.com')
    expect(ucp.shop.returns_policy).toBeNull()
  })

  test('the unknown-shop fallback branch (no listing.shop) sets both to null', () => {
    const ucp = toUcpListing(listing({ shop: undefined }), 'https://miyagisanchez.com')
    expect(ucp.shop.about).toBeNull()
    expect(ucp.shop.returns_policy).toBeNull()
  })
})
