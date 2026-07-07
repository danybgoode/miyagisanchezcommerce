import { expect, test } from '@playwright/test'
import {
  splitCategoriesFrontend,
  shortCollectionSlug,
  deriveShopCollections,
} from '../lib/collection-derive'
import type { Listing } from '../lib/types'

/**
 * Pure-logic spec for own-shop-premium-presentation S2's collection
 * derivation (mirrors apps/backend's category-split.unit.spec.ts). Kept in
 * the next-free lib/collection-derive.ts seam so this runs without
 * network/auth, same discipline as home-curation.spec.ts.
 */

function makeListing(p: Partial<Listing> & { id: string }): Listing {
  return {
    id: p.id,
    shop_id: 'shop_1',
    medusa_product_id: p.id,
    title: p.title ?? 'Test listing',
    description: null,
    price_cents: 10000,
    currency: 'MXN',
    condition: 'good',
    listing_type: 'product',
    category: p.category ?? 'otros',
    collections: p.collections ?? [],
    state: null,
    municipio: null,
    location: 'CDMX',
    metadata: {},
    images: [{ url: 'https://img/x.jpg' }],
    tags: [],
    status: 'active',
    source_platform: null,
    source_url: null,
    views: 0,
    created_at: new Date().toISOString(),
  } as Listing
}

test.describe('splitCategoriesFrontend', () => {
  test('finds the platform category regardless of array position', () => {
    const result = splitCategoriesFrontend(
      [
        { id: 'cat_zines', handle: 'miyagiprints-zines' },
        { id: 'cat_moda', handle: 'moda' },
      ],
      'miyagiprints',
    )
    expect(result.platformCategory?.handle).toBe('moda')
    expect(result.collections.map((c) => c.handle)).toEqual(['miyagiprints-zines'])
  })

  test('sorts collections by metadata.sort_order, untagged last', () => {
    const result = splitCategoriesFrontend(
      [
        { id: 'cat_a', handle: 'miyagiprints-b', metadata: { sort_order: 1 } },
        { id: 'cat_b', handle: 'miyagiprints-a', metadata: { sort_order: 0 } },
      ],
      'miyagiprints',
    )
    expect(result.collections.map((c) => c.handle)).toEqual(['miyagiprints-a', 'miyagiprints-b'])
  })

  test('handles empty/absent categories without crashing', () => {
    expect(splitCategoriesFrontend(null, 'miyagiprints')).toEqual({ platformCategory: null, collections: [] })
    expect(splitCategoriesFrontend(undefined, 'miyagiprints')).toEqual({ platformCategory: null, collections: [] })
  })

  test('never leaks a different seller\'s namespaced handle into this seller\'s collections', () => {
    const result = splitCategoriesFrontend(
      [{ id: 'cat_other', handle: 'otherseller-zines' }],
      'miyagiprints',
    )
    expect(result.collections).toEqual([])
  })
})

test.describe('shortCollectionSlug', () => {
  test('strips the seller-namespace prefix', () => {
    expect(shortCollectionSlug('miyagiprints-die-cut', 'miyagiprints')).toBe('die-cut')
  })

  test('returns the handle unchanged when the prefix does not match', () => {
    expect(shortCollectionSlug('moda', 'miyagiprints')).toBe('moda')
  })
})

test.describe('deriveShopCollections', () => {
  test('"Todos" is always first, even with zero collections', () => {
    const entries = deriveShopCollections([makeListing({ id: 'p1' })], [], '/s/miyagiprints', 'miyagiprints')
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('Todos')
    expect(entries[0].count).toBe(1)
  })

  test('preserves sort_order and uses short slugs in hrefs', () => {
    const listings = [
      makeListing({ id: 'p1', collections: ['miyagiprints-zines'] }),
      makeListing({ id: 'p2', collections: ['miyagiprints-zines', 'miyagiprints-die-cut'] }),
    ]
    const entries = deriveShopCollections(
      listings,
      [
        { id: 'cat_diecut', handle: 'miyagiprints-die-cut', name: 'Die-cut', sort_order: 0 },
        { id: 'cat_zines', handle: 'miyagiprints-zines', name: 'Zines', sort_order: 1 },
      ],
      '/s/miyagiprints',
      'miyagiprints',
    )
    expect(entries.map((e) => e.label)).toEqual(['Todos', 'Die-cut', 'Zines'])
    expect(entries[1].href).toBe('/s/miyagiprints/c/die-cut')
    expect(entries[1].count).toBe(1)
    expect(entries[2].count).toBe(2)
  })

  test('sorts by sort_order even when the input array arrives UNSORTED — a live bug caught by cross-review: the sort previously read a nonexistent .metadata.sort_order field on this exact shape and silently no-opped', () => {
    const entries = deriveShopCollections(
      [],
      [
        { id: 'cat_c', handle: 'miyagiprints-c', name: 'C', sort_order: 2 },
        { id: 'cat_a', handle: 'miyagiprints-a', name: 'A', sort_order: 0 },
        { id: 'cat_b', handle: 'miyagiprints-b', name: 'B', sort_order: 1 },
      ],
      '',
      'miyagiprints',
    )
    expect(entries.map((e) => e.label)).toEqual(['Todos', 'A', 'B', 'C'])
  })

  test('multi-collection membership on one listing is preserved in counts', () => {
    const listings = [makeListing({ id: 'p1', collections: ['miyagiprints-a', 'miyagiprints-b'] })]
    const entries = deriveShopCollections(
      listings,
      [
        { id: 'cat_a', handle: 'miyagiprints-a', name: 'A', sort_order: 0 },
        { id: 'cat_b', handle: 'miyagiprints-b', name: 'B', sort_order: 1 },
      ],
      '',
      'miyagiprints',
    )
    expect(entries.find((e) => e.shortSlug === 'a')?.count).toBe(1)
    expect(entries.find((e) => e.shortSlug === 'b')?.count).toBe(1)
  })
})
