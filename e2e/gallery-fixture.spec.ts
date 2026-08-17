import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { pickFixtureListing, resolveGalleryListing, type CatalogItem } from './_helpers/gallery-fixture'

/**
 * The pure half of gallery-fixture discovery. It replaced three hand-rotated
 * GitHub Actions secrets after two of them silently pointed at listings on
 * shops an admin had deleted, taking the nightly smoke red and presenting it as
 * a gallery regression.
 */

const img = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `img-${i}` }))

const catalog: CatalogItem[] = [
  { id: 'prod_ten', images: img(10) },
  { id: 'prod_three', images: img(3) },
  { id: 'prod_two_b', images: img(2) },
  { id: 'prod_two_a', images: img(2) },
  { id: 'prod_one', images: img(1) },
  { id: 'prod_none', images: [] },
]

test.describe('pickFixtureListing', () => {
  test('matches on photo COUNT, not on position in the catalog', () => {
    expect(pickFixtureListing(catalog, 'zero')).toBe('prod_none')
    expect(pickFixtureListing(catalog, 'single')).toBe('prod_one')
  })

  test('multi picks the CHEAPEST qualifying listing, not the first one', () => {
    // `page.goto` waits for `load`, which waits for every image. Taking the
    // first match in catalog order picked a ten-image PDP and blew the 30s test
    // timeout under parallel workers — found by running it against production.
    expect(pickFixtureListing(catalog, 'multi')).toBe('prod_two_a')
  })

  test('ties break on id, so the choice is reproducible across runs', () => {
    // Two 2-image listings exist; the winner must not depend on response order,
    // or a flake in one run cannot be reproduced in the next.
    const reversed = [...catalog].reverse()
    expect(pickFixtureListing(reversed, 'multi')).toBe(pickFixtureListing(catalog, 'multi'))
  })

  test('a missing `images` key counts as zero photos, not as a crash', () => {
    expect(pickFixtureListing([{ id: 'prod_x' }], 'zero')).toBe('prod_x')
    expect(pickFixtureListing([{ id: 'prod_x' }], 'single')).toBeNull()
  })

  test('returns null — never an arbitrary listing — when nothing matches', () => {
    // This is the state the live catalog is in for `zero` today. It must be
    // distinguishable from success, so the caller can skip with a REASON rather
    // than run the spec against a listing of the wrong shape and pass vacuously.
    expect(pickFixtureListing([{ id: 'prod_one', images: img(1) }], 'zero')).toBeNull()
    expect(pickFixtureListing([], 'multi')).toBeNull()
  })
})

/**
 * A minimal `request.get()` stand-in — just enough of the Playwright
 * `APIRequestContext` surface these tests touch (`.ok()` / `.json()`), keyed by
 * URL prefix so both the single-listing lookup and the paginated catalog scan
 * can be stubbed in one fixture.
 */
function fakeRequest(responses: Record<string, { ok: boolean; body?: unknown }>): APIRequestContext {
  return {
    get: async (url: string) => {
      const key = Object.keys(responses).find((k) => url.startsWith(k))
      const res = key ? responses[key] : { ok: false }
      return {
        ok: () => res.ok,
        status: () => (res.ok ? 200 : 404),
        json: async () => res.body,
      }
    },
  } as unknown as APIRequestContext
}

test.describe('resolveGalleryListing — pinned override validation', () => {
  // 2026-08-17: this is the regression itself — MS_TEST_GALLERY_SINGLE_LISTING_ID
  // and MS_TEST_GALLERY_ZERO_LISTING_ID were still set in CI, still pointing at the
  // listings deleted on 2026-08-15, and `if (envOverride) return { listingId: ... }`
  // trusted them without ever reaching the discovery this file exists for.

  test('a live pin matching the requested shape is used as-is', async () => {
    const request = fakeRequest({
      '/api/ucp/catalog/pinned_1': { ok: true, body: { id: 'pinned_1', images: img(1) } },
    })
    const fixture = await resolveGalleryListing(request, 'single', 'pinned_1')
    expect(fixture).toEqual({ listingId: 'pinned_1', source: 'env' })
  })

  test('a pin that 404s (deleted or unpublished) falls back to catalog discovery', async () => {
    const request = fakeRequest({
      '/api/ucp/catalog/pinned_dead': { ok: false },
      '/api/ucp/catalog?limit=50&page=1': { ok: true, body: { items: catalog } },
    })
    const fixture = await resolveGalleryListing(request, 'single', 'pinned_dead')
    expect(fixture).toEqual({ listingId: 'prod_one', source: 'catalog' })
  })

  test('a pin whose photo count no longer matches the pinned shape falls back to discovery', async () => {
    const request = fakeRequest({
      '/api/ucp/catalog/pinned_wrong_shape': { ok: true, body: { id: 'pinned_wrong_shape', images: img(3) } },
      '/api/ucp/catalog?limit=50&page=1': { ok: true, body: { items: catalog } },
    })
    const fixture = await resolveGalleryListing(request, 'single', 'pinned_wrong_shape')
    expect(fixture).toEqual({ listingId: 'prod_one', source: 'catalog' })
  })

  test('a pin lookup that errors falls back to discovery rather than throwing', async () => {
    const request = {
      get: async (url: string) => {
        if (url.startsWith('/api/ucp/catalog/pinned_unreachable')) throw new Error('network error')
        return { ok: () => true, status: () => 200, json: async () => ({ items: catalog }) }
      },
    } as unknown as APIRequestContext
    const fixture = await resolveGalleryListing(request, 'single', 'pinned_unreachable')
    expect(fixture).toEqual({ listingId: 'prod_one', source: 'catalog' })
  })

  // The skip reason is the ONLY place a rejected pin is visible once discovery
  // succeeds or comes up empty. Without it the log says "no such listing exists"
  // while a stale secret is quietly still set — which is exactly how this defect
  // got independently re-diagnosed on two consecutive nights.
  test('a stale pin with nothing to discover names the pin it rejected', async () => {
    const request = fakeRequest({
      '/api/ucp/catalog/pinned_dead': { ok: false },
      '/api/ucp/catalog?limit=50&page=1': { ok: true, body: { items: [{ id: 'prod_one', images: img(1) }] } },
    })
    const fixture = await resolveGalleryListing(request, 'zero', 'pinned_dead')
    expect(fixture.listingId).toBeNull()
    expect(fixture.source).toBe('unavailable')
    expect(fixture.reason).toContain('pinned override pinned_dead was checked and no longer qualifies')
  })

  test('with no pin set, the reason does not claim a pin was checked', async () => {
    const request = fakeRequest({
      '/api/ucp/catalog?limit=50&page=1': { ok: true, body: { items: [{ id: 'prod_one', images: img(1) }] } },
    })
    const fixture = await resolveGalleryListing(request, 'zero', undefined)
    expect(fixture.listingId).toBeNull()
    expect(fixture.reason).not.toContain('pinned override')
  })
})
