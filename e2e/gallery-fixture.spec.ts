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
 * A fake catalog endpoint — `resolveGalleryListing` only ever calls
 * `request.get(url)` and reads `.ok()` / `.status()` / `.json()` off the
 * result, so a plain object satisfies it without spinning up a server.
 */
function fakeRequest(items: CatalogItem[]): APIRequestContext {
  return {
    get: async () => ({
      ok: () => true,
      status: () => 200,
      json: async () => ({ items }),
    }),
  } as unknown as APIRequestContext
}

test.describe('resolveGalleryListing — env pin', () => {
  test('a pin still present in the catalog, with the right shape, wins over discovery', async () => {
    const request = fakeRequest(catalog)
    const result = await resolveGalleryListing(request, 'multi', 'prod_ten')
    expect(result).toEqual({ listingId: 'prod_ten', source: 'env' })
  })

  // The 2026-08-16 regression: MS_TEST_GALLERY_SINGLE_LISTING_ID and
  // MS_TEST_GALLERY_ZERO_LISTING_ID stayed wired in the workflow after
  // rotting once already, and a bare `if (envOverride)` trusted them anyway —
  // discovery never ran, so the same stale ids kept failing the smoke.
  test('a pin the catalog no longer lists is treated as absent — discovery runs instead', async () => {
    const request = fakeRequest(catalog)
    const result = await resolveGalleryListing(request, 'multi', 'prod_deleted')
    expect(result).toEqual({ listingId: 'prod_two_a', source: 'catalog' })
  })

  test('a pin that exists but is now the wrong shape is treated as absent — discovery runs instead', async () => {
    const request = fakeRequest(catalog)
    // prod_one has exactly one photo — pinning it for the `multi` fixture is stale.
    const result = await resolveGalleryListing(request, 'multi', 'prod_one')
    expect(result).toEqual({ listingId: 'prod_two_a', source: 'catalog' })
  })

  test('a stale pin with nothing to discover skips honestly, naming the pin as checked', async () => {
    const request = fakeRequest([{ id: 'prod_one', images: img(1) }])
    const result = await resolveGalleryListing(request, 'zero', 'prod_stale')
    expect(result.listingId).toBeNull()
    expect(result.source).toBe('unavailable')
    expect(result.reason).toContain('the pinned id no longer qualifies either')
  })

  test('no pin set — discovery runs as before', async () => {
    const request = fakeRequest(catalog)
    const result = await resolveGalleryListing(request, 'zero', undefined)
    expect(result).toEqual({ listingId: 'prod_none', source: 'catalog' })
  })
})
