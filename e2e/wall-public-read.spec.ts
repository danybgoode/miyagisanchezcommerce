import { test, expect } from '@playwright/test'
import { visibleEntries } from '../lib/wall/feed'
import { toProductView, toCollectionView, toEventView, COLLECTION_SAMPLE_SIZE } from '../lib/wall/views'
import { WALL_PAGE_SIZE } from '../lib/wall/validate'
import type { PublicWallEntry } from '../lib/wall/types'
import type { Listing } from '../lib/types'
import type { MarketplaceEvent } from '../lib/events-types'

/**
 * Living Shop · Sprint 2 — the public Wall (Stories 2.1–2.4).
 *
 * Two layers, deliberately separated:
 *   1. PURE — the card views and the unavailable-reference rule. No network.
 *   2. LIVE — the public read route, anonymous, against whatever `baseURL` is.
 *      It asserts only things that are true of ANY shop, so it needs no fixture
 *      pinned to a row someone can delete (a spec pinned to a hand-picked
 *      fixture went red the morning a shop was removed through the admin).
 *
 * Observed red by: making `visibleEntries` return everything (the unavailable
 * case failed), and by dropping the `available` mapping in `toProductView` (the
 * sold-out case failed).
 */

const entry = (over: Partial<PublicWallEntry>): PublicWallEntry => ({
  id: 'e1',
  kind: 'post',
  body: 'hola',
  media: [],
  pinned: false,
  effective_at: '2026-08-18T10:00:00.000Z',
  reference: { state: 'none' },
  ...over,
})

const listing = (over: Partial<Listing>): Listing => ({
  id: 'prod_1',
  title: 'Bolsa tejida',
  price_cents: 45000,
  currency: 'MXN',
  images: [{ url: 'https://img.example.com/a.jpg', alt: null }],
  in_stock: true,
  collections: ['verano'],
  status: 'active',
  ...over,
} as Listing)

test.describe('wall public · an unavailable reference disappears', () => {
  test('entries whose object is gone are dropped, in ONE place', () => {
    const kept = visibleEntries([
      entry({ id: 'post' }),
      entry({ id: 'dead', kind: 'product', reference: { state: 'unavailable', reason: 'missing' } }),
      entry({ id: 'foreign', kind: 'event', reference: { state: 'unavailable', reason: 'foreign' } }),
    ])
    expect(kept.map((e) => e.id)).toEqual(['post'])
  })

  test('a plain post is never dropped — it has no reference to lose', () => {
    expect(visibleEntries([entry({})])).toHaveLength(1)
  })
})

test.describe('wall public · card views reflect the canonical object', () => {
  test('a product card carries the CURRENT price and links to the existing PDP', () => {
    const view = toProductView(listing({}), '/mx/s/mi-tienda', 'es-MX')
    expect(view.href).toBe('/mx/s/mi-tienda/l/prod_1')
    expect(view.formattedPrice).toContain('450')
    expect(view.available).toBe(true)
  })

  test('an out-of-stock product is marked unavailable rather than hidden', () => {
    expect(toProductView(listing({ in_stock: false }), '', 'es-MX').available).toBe(false)
  })

  test('a product with no price renders no price at all, never a zero', () => {
    expect(toProductView(listing({ price_cents: null } as Partial<Listing>), '', 'es-MX').formattedPrice).toBeNull()
  })

  test('on an owned host the product href is relative — no marketplace prefix leaks', () => {
    expect(toProductView(listing({}), '', 'es-MX').href).toBe('/l/prod_1')
  })

  test('a collection card samples a BOUNDED number of its current products', () => {
    const members = Array.from({ length: 9 }, (_, i) => listing({ id: `p${i}`, title: `Producto ${i}` }))
    const view = toCollectionView({ handle: 'verano', name: 'Verano' }, members, '')
    expect(view.sample).toHaveLength(COLLECTION_SAMPLE_SIZE)
    expect(view.productCount).toBe(9)
    expect(view.href).toBe('/c/verano')
  })

  const event = (over: Partial<MarketplaceEvent>): MarketplaceEvent => ({
    slug: 'feria-otono',
    title: 'Feria de otoño',
    starts_at: '2026-09-20T18:00:00.000Z',
    venue_name: 'Parque México',
    status: 'active',
    ...over,
  } as MarketplaceEvent)

  test('an upcoming event links to its existing public page', () => {
    const view = toEventView(event({}), new Date('2026-08-18T00:00:00Z'))
    expect(view.href).toBe('/e/feria-otono')
    expect(view.cancelled).toBe(false)
    expect(view.past).toBe(false)
  })

  test('cancelled and past are DEFINED states, not absence', () => {
    expect(toEventView(event({ status: 'cancelled' }), new Date('2026-08-18T00:00:00Z')).cancelled).toBe(true)
    expect(toEventView(event({}), new Date('2027-01-01T00:00:00Z')).past).toBe(true)
  })
})

test.describe('wall public read route · anonymous', () => {
  test('an unknown shop is 404, and an unreachable backend is 503 — never a silent empty Wall', async ({ request }) => {
    const res = await request.get('/api/shop/wall?slug=definitivamente-no-existe-esta-tienda')
    // 503 is the legitimate answer when the commerce backend cannot be reached
    // (a local dev run without Medusa produces exactly that). What must NEVER
    // happen is a 200 with an empty Wall, which would read as "this merchant has
    // posted nothing" when the truth is "we could not check".
    expect([404, 503]).toContain(res.status())
    expect(res.status()).not.toBe(200)
  })

  test('a malformed slug is refused before any lookup', async ({ request }) => {
    expect((await request.get('/api/shop/wall?slug=..%2F..%2Fetc')).status()).toBe(404)
    expect((await request.get('/api/shop/wall')).status()).toBe(404)
  })

  /**
   * Fixture DISCOVERED, never pinned: the first shop the public catalog names.
   * A hardcoded slug rots the moment that shop is renamed or removed, which has
   * already taken this suite red once.
   */
  async function anyPublicShopSlug(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
    const res = await request.get('/api/ucp/catalog?limit=20')
    if (!res.ok()) return null
    const data = await res.json() as { products?: Array<{ seller?: { slug?: string } }> }
    return data.products?.find((p) => p.seller?.slug)?.seller?.slug ?? null
  }

  test('a real shop answers a BOUNDED page, and never a draft', async ({ request }) => {
    const slug = await anyPublicShopSlug(request)
    test.skip(!slug, 'FIXTURE UNAVAILABLE: the public catalog named no shop slug')
    const res = await request.get(`/api/shop/wall?slug=${slug}`)
    expect(res.status()).toBe(200)
    const data = await res.json() as { entries: PublicWallEntry[]; hasMore: boolean; total: number }
    expect(Array.isArray(data.entries)).toBe(true)
    expect(data.entries.length).toBeLessThanOrEqual(WALL_PAGE_SIZE)
    // Whatever comes back is public by construction: every entry carries the
    // instant it became visible, and that instant is in the past.
    for (const e of data.entries) {
      expect(Date.parse(e.effective_at)).toBeLessThanOrEqual(Date.now())
    }
  })

  test('an absurd offset is clamped rather than accepted', async ({ request }) => {
    const slug = await anyPublicShopSlug(request)
    test.skip(!slug, 'FIXTURE UNAVAILABLE: the public catalog named no shop slug')
    const res = await request.get(`/api/shop/wall?slug=${slug}&offset=99999999`)
    expect(res.status()).toBe(200)
    const data = await res.json() as { entries: unknown[]; hasMore: boolean }
    expect(data.entries).toEqual([])
    expect(data.hasMore).toBe(false)
  })
})
