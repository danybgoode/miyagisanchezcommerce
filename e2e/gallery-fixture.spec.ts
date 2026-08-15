import { expect, test } from '@playwright/test'
import { pickFixtureListing, type CatalogItem } from './_helpers/gallery-fixture'

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
