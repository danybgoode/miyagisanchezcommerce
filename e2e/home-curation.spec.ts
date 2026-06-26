import { expect, test } from '@playwright/test'
import {
  isPinned,
  isQualifying,
  pickFeatured,
  curateGrid,
  featuredRank,
  isRecentForBadge,
  liveCategoryCounts,
  seededShuffle,
  windowSeed,
  MAX_AGE_DAYS,
  RECENT_HOURS,
  REVALIDATE_MS,
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

test.describe('home-curation · pins authoritative over price (S1.1)', () => {
  // A pinned "Sin precio" listing (event / agenda / art) the admin ranks #1.
  const pinnedNoPrice = makeListing({
    id: 'pinned-no-price',
    price_cents: null,
    metadata: { featured: true, featured_rank: 1 },
  })
  const pinnedNoImage = makeListing({
    id: 'pinned-no-image',
    images: [],
    metadata: { featured: true, featured_rank: 1 },
  })
  const pinnedDraft = makeListing({
    id: 'pinned-draft',
    status: 'draft',
    metadata: { featured: true, featured_rank: 1 },
  })

  test('a PINNED no-price listing qualifies and is the Destacado at rank 1', () => {
    expect(isQualifying(pinnedNoPrice, NOW)).toBe(true)
    expect(pickFeatured([fresh, pinnedNoPrice], NOW)?.id).toBe('pinned-no-price')
  })

  test('an UNPINNED no-price listing is still excluded', () => {
    expect(isQualifying(noPrice, NOW)).toBe(false)
    expect(curateGrid([fresh, noPrice], NOW).map(l => l.id)).not.toContain('no-price')
  })

  test('a PINNED no-image listing is still excluded (no broken Destacado)', () => {
    expect(isQualifying(pinnedNoImage, NOW)).toBe(false)
    expect(pickFeatured([fresh, pinnedNoImage], NOW)?.id).toBe('fresh')
  })

  test('a PINNED non-active (draft) listing is still excluded', () => {
    expect(isQualifying(pinnedDraft, NOW)).toBe(false)
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

test.describe('home-curation · featured_rank (admin order)', () => {
  // Two pins, OLDER one ranked first → rank must beat created_at within the pin group.
  const pinRank1Old = makeListing({
    id: 'pin-rank-1',
    created_at: new Date(NOW - 100 * DAY).toISOString(),
    metadata: { featured: true, featured_rank: 1 },
  })
  const pinRank2New = makeListing({
    id: 'pin-rank-2',
    created_at: new Date(NOW - 50 * DAY).toISOString(),
    metadata: { featured: true, featured_rank: 2 },
  })

  test('featuredRank reads the metadata; non-pins / unranked → Infinity', () => {
    expect(featuredRank(pinRank1Old)).toBe(1)
    expect(featuredRank(fresh)).toBe(Infinity)
    expect(featuredRank(pinnedStale)).toBe(Infinity) // pinned but no rank
  })

  test('a lower featured_rank sorts first, regardless of created_at', () => {
    expect(pickFeatured([pinRank2New, pinRank1Old], NOW)?.id).toBe('pin-rank-1')
    expect(curateGrid([pinRank2New, pinRank1Old], NOW).map(l => l.id)).toEqual(['pin-rank-1', 'pin-rank-2'])
  })

  test('the lowest-rank pin is the featured pick; the next-rank leads the grid', () => {
    const pool = [fresh, pinRank2New, pinRank1Old]
    const featured = pickFeatured(pool, NOW)
    expect(featured?.id).toBe('pin-rank-1')
    expect(curateGrid(pool, NOW, 4, featured?.id)[0].id).toBe('pin-rank-2')
  })

  test('an unranked pin falls back to fresh order, but still beats unpinned', () => {
    // pinnedStale has no rank (Infinity) → sorts after ranked pins, before unpinned fresh.
    const pool = [fresh, pinnedStale, pinRank1Old]
    expect(curateGrid(pool, NOW).map(l => l.id)).toEqual(['pin-rank-1', 'pinned', 'fresh'])
  })

  test('unpinned ordering is unchanged (freshest first)', () => {
    const a = makeListing({ id: 'a', created_at: new Date(NOW - 1 * DAY).toISOString() })
    const b = makeListing({ id: 'b', created_at: new Date(NOW - 3 * DAY).toISOString() })
    expect(curateGrid([b, a], NOW).map(l => l.id)).toEqual(['a', 'b'])
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

test.describe('home-curation · per-window shuffle (S3.1)', () => {
  // A pool of 6 unpinned fresh listings (distinct ages so the no-seed order is total)
  // plus two pins ranked 1 & 2 — enough entropy that some windows reorder the tail.
  const unpinnedIds = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5']
  const unpinned = unpinnedIds.map((id, i) =>
    makeListing({ id, created_at: new Date(NOW - (i + 1) * HOUR).toISOString() }))
  const pinA = makeListing({ id: 'pin-a', metadata: { featured: true, featured_rank: 1 } })
  const pinB = makeListing({ id: 'pin-b', metadata: { featured: true, featured_rank: 2 } })
  const pool = [...unpinned, pinA, pinB]
  const BIG = 100 // grab the whole ordering, not just the first GRID_SIZE

  test('windowSeed is stable within a window and increments across windows', () => {
    const base = 1_000 * REVALIDATE_MS // a window boundary
    expect(windowSeed(base)).toBe(windowSeed(base + REVALIDATE_MS - 1)) // same window
    expect(windowSeed(base + REVALIDATE_MS)).toBe(windowSeed(base) + 1) // next window
    expect(windowSeed(base + REVALIDATE_MS)).not.toBe(windowSeed(base))
  })

  test('seededShuffle is deterministic and non-mutating', () => {
    const input = [...unpinnedIds]
    expect(seededShuffle(input, 7)).toEqual(seededShuffle(input, 7)) // same seed ⇒ same order
    expect(input).toEqual(unpinnedIds) // input untouched
    // It is a permutation — same multiset of elements.
    expect([...seededShuffle(input, 7)].sort()).toEqual([...unpinnedIds].sort())
  })

  test('same seed ⇒ identical grid order (no hydration mismatch within a window)', () => {
    const seed = windowSeed(1_700_000_000_000)
    const a = curateGrid(pool, NOW, BIG, undefined, seed).map(l => l.id)
    const b = curateGrid(pool, NOW, BIG, undefined, seed).map(l => l.id)
    expect(a).toEqual(b)
  })

  test('the seeded grid is a permutation of the unseeded grid (same set, nothing lost)', () => {
    const seeded = curateGrid(pool, NOW, BIG, undefined, 42).map(l => l.id).sort()
    const plain = curateGrid(pool, NOW, BIG).map(l => l.id).sort()
    expect(seeded).toEqual(plain)
  })

  test('pinned items stay fixed (leading, in featured_rank order) across every window', () => {
    for (let bucket = 0; bucket < 12; bucket++) {
      const ids = curateGrid(pool, NOW, BIG, undefined, bucket).map(l => l.id)
      expect(ids.slice(0, 2)).toEqual(['pin-a', 'pin-b']) // pins lead, rank order
      expect(ids.slice(2).sort()).toEqual([...unpinnedIds].sort()) // only the tail is the unpinned set
    }
  })

  test('different windows produce different unpinned orders (rotation)', () => {
    const tail = (seed: number) =>
      curateGrid(pool, NOW, BIG, undefined, seed).slice(2).map(l => l.id).join(',')
    const orders = new Set<string>()
    for (let bucket = 0; bucket < 12; bucket++) orders.add(tail(bucket))
    expect(orders.size).toBeGreaterThan(1) // at least two distinct rotations across windows
  })
})
