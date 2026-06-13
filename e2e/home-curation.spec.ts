import { expect, test } from '@playwright/test'
import {
  isPinned,
  isQualifying,
  pickFeatured,
  curateGrid,
  isRecentForBadge,
  liveCategoryCounts,
  MAX_AGE_DAYS,
  RECENT_HOURS,
} from '../lib/home-curation'
import { CATEGORIES } from '../lib/types'
import type { Listing } from '../lib/types'

/**
 * Homepage Polish — Dirección B · Sprint 2: the curation + count rules live in the
 * next-free `lib/home-curation.ts` seam, so this proves them without network/auth —
 * the homepage's `getCuratedListings` / `getFeaturedListing` / `getCategoryCounts`
 * wrappers only add the Medusa fetch around this logic.
 */

const NOW = Date.parse('2026-06-12T12:00:00Z')
const DAY = 86_400_000
const HOUR = 3_600_000

// Minimal Listing factory — only the fields the curation logic reads.
function makeListing(p: Partial<Listing> & { id: string }): Listing {
  return {
    id: p.id,
    shop_id: 'shop_1',
    medusa_product_id: p.id,
    title: p.title ?? 'Test listing',
    description: null,
    price_cents: p.price_cents !== undefined ? p.price_cents : 10000,
    currency: 'MXN',
    condition: p.condition ?? 'good',
    listing_type: 'product',
    category: p.category ?? 'otros',
    state: null,
    municipio: null,
    location: p.location ?? 'CDMX',
    metadata: p.metadata ?? {},
    images: p.images ?? [{ url: 'https://img/x.jpg' }],
    tags: [],
    status: p.status ?? 'active',
    source_platform: null,
    source_url: null,
    views: 0,
    created_at: p.created_at ?? new Date(NOW - HOUR).toISOString(),
  } as Listing
}

const fresh = makeListing({ id: 'fresh', created_at: new Date(NOW - 2 * DAY).toISOString() })
const stale = makeListing({ id: 'stale', created_at: new Date(NOW - (MAX_AGE_DAYS + 5) * DAY).toISOString() })
const pinnedStale = makeListing({
  id: 'pinned',
  created_at: new Date(NOW - (MAX_AGE_DAYS + 30) * DAY).toISOString(),
  metadata: { featured: true },
})
const noImage = makeListing({ id: 'no-image', images: [] })
const noPrice = makeListing({ id: 'no-price', price_cents: null })
const draft = makeListing({ id: 'draft', status: 'draft' })

test.describe('home-curation · qualifying rule', () => {
  test('a fresh active listing with image + price qualifies', () => {
    expect(isQualifying(fresh, NOW)).toBe(true)
  })

  test('a >14-day UNPINNED listing is excluded (cold-start, not recency)', () => {
    expect(isQualifying(stale, NOW)).toBe(false)
    expect(curateGrid([fresh, stale], NOW).map(l => l.id)).not.toContain('stale')
    expect(pickFeatured([stale], NOW)).toBeNull()
  })

  test('a PINNED listing qualifies even past the 14-day cutoff', () => {
    expect(isPinned(pinnedStale)).toBe(true)
    expect(isQualifying(pinnedStale, NOW)).toBe(true)
  })

  test('no image or no price disqualifies', () => {
    expect(isQualifying(noImage, NOW)).toBe(false)
    expect(isQualifying(noPrice, NOW)).toBe(false)
  })

  test('a non-active (draft) listing is excluded', () => {
    expect(isQualifying(draft, NOW)).toBe(false)
  })
})

test.describe('home-curation · featured + grid', () => {
  test('a pinned listing is the featured pick over a fresher unpinned one', () => {
    const f = pickFeatured([fresh, pinnedStale], NOW)
    expect(f?.id).toBe('pinned')
  })

  test('with no pin, the freshest qualifying listing is featured', () => {
    const older = makeListing({ id: 'older', created_at: new Date(NOW - 5 * DAY).toISOString() })
    expect(pickFeatured([older, fresh], NOW)?.id).toBe('fresh')
  })

  test('the grid never repeats the featured card', () => {
    const pool = [pinnedStale, fresh, makeListing({ id: 'b', created_at: new Date(NOW - 3 * DAY).toISOString() })]
    const featured = pickFeatured(pool, NOW)
    const grid = curateGrid(pool, NOW, 4, featured?.id)
    expect(featured?.id).toBe('pinned')
    expect(grid.map(l => l.id)).not.toContain(featured?.id)
  })

  test('the grid is capped at n', () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      makeListing({ id: `g${i}`, created_at: new Date(NOW - (i + 1) * HOUR).toISOString() }))
    expect(curateGrid(pool, NOW, 4).length).toBe(4)
  })
})

test.describe('home-curation · recent badge', () => {
  test('true under 48h, false at/after', () => {
    expect(isRecentForBadge(new Date(NOW - (RECENT_HOURS - 1) * HOUR).toISOString(), NOW)).toBe(true)
    expect(isRecentForBadge(new Date(NOW - (RECENT_HOURS + 1) * HOUR).toISOString(), NOW)).toBe(false)
  })
})

test.describe('home-curation · live category counts', () => {
  test('drops empty categories and keeps CATEGORIES order', () => {
    const counts: Record<string, number> = { autos: 3, electronica: 7 }
    const live = liveCategoryCounts(counts)
    expect(live.map(c => c.key)).toEqual(['autos', 'electronica'])
    expect(live.find(c => c.key === 'autos')?.count).toBe(3)
    // order follows CATEGORIES (autos precedes electronica there)
    const autosIdx = CATEGORIES.findIndex(c => c.key === 'autos')
    const elecIdx = CATEGORIES.findIndex(c => c.key === 'electronica')
    expect(autosIdx).toBeLessThan(elecIdx)
  })

  test('a zero count is dropped, never rendered as an empty category', () => {
    const live = liveCategoryCounts({ autos: 0, moda: 2 })
    expect(live.map(c => c.key)).toEqual(['moda'])
  })

  test('each live entry carries the Iconoir glyph name from CATEGORIES', () => {
    const live = liveCategoryCounts({ autos: 1 })
    expect(live[0].icon).toBe(CATEGORIES.find(c => c.key === 'autos')?.icon)
  })
})
