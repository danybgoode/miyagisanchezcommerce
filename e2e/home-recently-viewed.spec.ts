import { expect, test } from '@playwright/test'
import { dedupeCapViewed, type ViewedEntry } from '../lib/home-recently-viewed'
import { viewedLabel, mergeRailCards, RAIL_CAP, type ViewedWithCard } from '../lib/home-recently-viewed-merge'
import type { RecentFavorite } from '../lib/home-favorites'

/**
 * home-dynamic-rows-restore-and-polish — Sprint 2, Story 2.3. Pure-logic coverage for
 * the recently-viewed ring buffer + the rail's favorites/viewed merge-and-label seam —
 * no localStorage, no network, no browser.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function makeFavorite(overrides: Partial<RecentFavorite> = {}): RecentFavorite {
  return {
    medusaId: 'prod_fav', title: 'Favorito', priceCents: 10000, currency: 'MXN',
    condition: null, location: null, imageUrl: null, priceCentsAtSave: null,
    ...overrides,
  }
}

function makeViewedCard(medusaId: string, ts: number, overrides: Partial<ViewedWithCard['card']> = {}): ViewedWithCard {
  return {
    ts,
    card: {
      medusaId, title: `Visto ${medusaId}`, priceCents: 5000, currency: 'MXN',
      condition: null, location: null, imageUrl: null,
      ...overrides,
    },
  }
}

test.describe('home-recently-viewed · dedupeCapViewed', () => {
  test('re-viewing an id bumps it to the front with the new ts, not a duplicate', () => {
    const list: ViewedEntry[] = [{ id: 'a', ts: 100 }, { id: 'b', ts: 90 }]
    const next = dedupeCapViewed(list, { id: 'a', ts: 200 })
    expect(next).toEqual([{ id: 'a', ts: 200 }, { id: 'b', ts: 90 }])
  })

  test('caps to the given size, most-recent first', () => {
    const list: ViewedEntry[] = [{ id: 'a', ts: 3 }, { id: 'b', ts: 2 }]
    const next = dedupeCapViewed(list, { id: 'c', ts: 4 }, 2)
    expect(next).toEqual([{ id: 'c', ts: 4 }, { id: 'a', ts: 3 }])
  })
})

test.describe('home-recently-viewed-merge · viewedLabel', () => {
  test('same calendar day → Visto hoy', () => {
    const now = new Date('2026-07-13T20:00:00').getTime()
    const ts = new Date('2026-07-13T09:00:00').getTime()
    expect(viewedLabel(ts, now)).toBe('Visto hoy')
  })

  test('exactly one calendar day back → Visto ayer (even if less than 24h elapsed)', () => {
    const now = new Date('2026-07-13T01:00:00').getTime()
    const ts = new Date('2026-07-12T23:00:00').getTime()
    expect(viewedLabel(ts, now)).toBe('Visto ayer')
  })

  test('two or more calendar days back → null (dropped from the rail)', () => {
    const now = new Date('2026-07-13T12:00:00').getTime()
    const ts = new Date('2026-07-11T12:00:00').getTime()
    expect(viewedLabel(ts, now)).toBeNull()
  })

  test('a ts slightly in the future (clock skew) still reads Visto hoy, not a crash', () => {
    const now = Date.now()
    expect(viewedLabel(now + 60_000, now)).toBe('Visto hoy')
  })
})

test.describe('home-recently-viewed-merge · mergeRailCards', () => {
  test('favorites win on id collision — no duplicate, favorite label wins', () => {
    const now = Date.now()
    const favorites = [makeFavorite({ medusaId: 'prod_1' })]
    const viewed = [makeViewedCard('prod_1', now)]
    const out = mergeRailCards(favorites, viewed, now)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ medusaId: 'prod_1', source: 'favorite', label: 'Favorito' })
  })

  test('a viewed-only id (no collision) gets the correct source + label', () => {
    const now = Date.now()
    const out = mergeRailCards([], [makeViewedCard('prod_2', now)], now)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ medusaId: 'prod_2', source: 'viewed', label: 'Visto hoy' })
  })

  test('a stale (2+ day old) viewed entry is dropped entirely', () => {
    const now = Date.now()
    const stale = makeViewedCard('prod_3', now - 3 * DAY_MS)
    const out = mergeRailCards([], [stale], now)
    expect(out).toHaveLength(0)
  })

  test('RAIL_CAP truncation — favorites first, then viewed by most-recent', () => {
    const now = Date.now()
    const favorites = [makeFavorite({ medusaId: 'f1' }), makeFavorite({ medusaId: 'f2' })]
    const viewed = [
      makeViewedCard('v1', now - 3000),
      makeViewedCard('v2', now - 1000),
      makeViewedCard('v3', now - 2000),
      makeViewedCard('v4', now - 500),
      makeViewedCard('v5', now - 4000),
    ]
    const out = mergeRailCards(favorites, viewed, now)
    expect(out).toHaveLength(RAIL_CAP)
    expect(out.map((c) => c.medusaId)).toEqual(['f1', 'f2', 'v4', 'v2', 'v3', 'v1'])
  })

  test('a favorite with a price drop carries priceDrop through; viewed-only never shows one', () => {
    const now = Date.now()
    const favorites = [makeFavorite({ medusaId: 'f1', priceCentsAtSave: 20000, priceCents: 15000 })]
    const viewed = [makeViewedCard('v1', now)]
    const out = mergeRailCards(favorites, viewed, now)
    const fav = out.find((c) => c.medusaId === 'f1')!
    const view = out.find((c) => c.medusaId === 'v1')!
    expect(fav.priceDrop).toEqual({ dropped: true, dropAmountCents: 5000 })
    expect(view.priceDrop).toEqual({ dropped: false, dropAmountCents: 0 })
  })
})
