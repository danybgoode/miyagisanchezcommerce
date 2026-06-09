import { expect, test } from '@playwright/test'
import {
  buildPrintSocialAdminPatch,
  isNeighborhoodPulseSocialItem,
  NEIGHBORHOOD_PULSE_COPY,
  publicSubmitterLabel,
} from '../lib/neighborhood-pulse'
import { rankNeighborhoodListings, rankNeighborhoodShops } from '../lib/neighborhood-rank'

test.describe('neighborhood pulse · moderator web opt-in', () => {
  test('admin social PATCH remains secret-gated', async ({ request }) => {
    const res = await request.patch('/api/admin/print/social/smoke-id', {
      data: { web_visible: true },
    })

    expect(res.status()).toBe(401)
  })

  test('admin patch contract accepts only boolean web_visible', () => {
    expect(buildPrintSocialAdminPatch({ web_visible: true })).toEqual({
      ok: true,
      patch: { web_visible: true },
    })
    expect(buildPrintSocialAdminPatch({ web_visible: false })).toEqual({
      ok: true,
      patch: { web_visible: false },
    })
    expect(buildPrintSocialAdminPatch({ web_visible: 'true' })).toEqual({
      ok: false,
      error: 'Invalid web_visible',
    })
  })

  test('missing or null web_visible is hidden by default', () => {
    expect(isNeighborhoodPulseSocialItem({ status: 'approved' })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: null })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: false })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: true })).toBe(true)
  })

  test('secret-gated smoke proves DB default off and PATCH on/off', async ({ request }) => {
    const secret = process.env.NEIGHBORHOOD_PULSE_SMOKE_SECRET
    test.skip(!secret, 'Set NEIGHBORHOOD_PULSE_SMOKE_SECRET to run the mutating Neighborhood Pulse smoke.')

    const res = await request.post('/api/internal/neighborhood-pulse/smoke', {
      headers: { 'x-neighborhood-pulse-test-secret': secret! },
    })
    expect(res.ok()).toBeTruthy()

    const data = await res.json() as {
      default_off: boolean
      toggled_on: boolean
      toggled_off: boolean
      status_after_toggle: string | null
    }

    expect(data.default_off).toBe(true)
    expect(data.toggled_on).toBe(true)
    expect(data.toggled_off).toBe(true)
    expect(data.status_after_toggle).toBe('approved')
  })
})

test.describe('neighborhood pulse · public feed visibility', () => {
  test('feed predicate shows only opted-in approved or placed items', () => {
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: true })).toBe(true)
    expect(isNeighborhoodPulseSocialItem({ status: 'placed', web_visible: true })).toBe(true)
    expect(isNeighborhoodPulseSocialItem({ status: 'submitted', web_visible: true })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'rejected', web_visible: true })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: false })).toBe(false)
  })

  test('public feed route renders anonymously', async ({ request }) => {
    const res = await request.get('/vecindario')
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    expect(html).toContain(NEIGHBORHOOD_PULSE_COPY.title)
    expect(html).toContain(NEIGHBORHOOD_PULSE_COPY.eyebrow)
  })

  test('public submitter label never falls back to email', () => {
    expect(publicSubmitterLabel({ submitter_name: 'Ana López', submitter_email: 'ana@example.com' })).toBe('Ana López')
    expect(publicSubmitterLabel({ submitter_name: '  ', submitter_email: 'ana@example.com' })).toBe(NEIGHBORHOOD_PULSE_COPY.fallbackSubmitter)
    expect(publicSubmitterLabel({ submitter_email: 'ana@example.com' })).toBe(NEIGHBORHOOD_PULSE_COPY.fallbackSubmitter)
  })
})

test.describe('neighborhood pulse · entry loop', () => {
  test('feed HTML exposes the contribution CTA', async ({ request }) => {
    const res = await request.get('/vecindario')
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    expect(html).toContain(NEIGHBORHOOD_PULSE_COPY.contributeCta)
    expect(html).toContain('href="/comunidad/nuevo"')
  })
})

test.describe('neighborhood pulse · trending rank', () => {
  const now = new Date('2026-06-08T18:00:00.000Z').getTime()

  test('favorites and views outrank pure recency when signal is strong', () => {
    const ranked = rankNeighborhoodListings([
      { id: 'new', created_at: '2026-06-08T17:45:00.000Z', views: 0, favorite_count: 0 },
      { id: 'loved', created_at: '2026-06-01T17:45:00.000Z', views: 20, favorite_count: 4 },
      { id: 'seen', created_at: '2026-06-07T17:45:00.000Z', views: 30, favorite_count: 0 },
    ], now)

    expect(ranked.map((item) => item.id)).toEqual(['loved', 'seen', 'new'])
    expect(ranked[0].trend_score).toBeGreaterThan(ranked[1].trend_score)
  })

  test('zero-signal listings fall back to recency and tolerate null signals', () => {
    const ranked = rankNeighborhoodListings([
      { id: 'old', created_at: '2026-05-01T17:45:00.000Z', views: null, favorite_count: null },
      { id: 'new', created_at: '2026-06-08T17:45:00.000Z' },
      { id: 'middle', created_at: '2026-06-07T17:45:00.000Z', views: 0, favorite_count: 0 },
    ], now)

    expect(ranked.map((item) => item.id)).toEqual(['new', 'middle', 'old'])
    expect(ranked.every((item) => Number.isFinite(item.trend_score))).toBe(true)
  })
})

test.describe('neighborhood pulse · merchant spotlight', () => {
  const now = new Date('2026-06-08T18:00:00.000Z').getTime()

  test('shop ranking weighs orders, new listings, views, then recency', () => {
    const ranked = rankNeighborhoodShops([
      {
        id: 'quiet',
        slug: 'quiet-shop',
        name: 'Quiet Shop',
        created_at: '2026-06-01T10:00:00.000Z',
        latest_listing_at: '2026-06-08T17:30:00.000Z',
        listing_count: 1,
        view_count: 1,
        order_count: 0,
      },
      {
        id: 'busy',
        slug: 'busy-shop',
        name: 'Busy Shop',
        created_at: '2026-05-01T10:00:00.000Z',
        latest_listing_at: '2026-06-06T17:30:00.000Z',
        listing_count: 3,
        view_count: 40,
        order_count: 0,
      },
      {
        id: 'trusted',
        slug: 'trusted-shop',
        name: 'Trusted Shop',
        created_at: '2026-04-01T10:00:00.000Z',
        latest_listing_at: '2026-06-01T17:30:00.000Z',
        listing_count: 1,
        view_count: 10,
        order_count: 2,
      },
    ], now)

    expect(ranked.map((shop) => shop.slug)).toEqual(['trusted-shop', 'busy-shop', 'quiet-shop'])
    expect(ranked.every((shop) => Number.isFinite(shop.spotlight_score))).toBe(true)
  })

  test('spotlight route is public, read-only, and returns shop cards', async ({ request }) => {
    const res = await request.get('/api/neighborhood-pulse/spotlight?limit=3')
    expect(res.ok()).toBeTruthy()

    const data = await res.json() as {
      shops: Array<{
        slug?: string
        name?: string
        tagline?: string
        colonia?: string
        spotlight_score?: number
      }>
      _meta?: { view?: string; read_only?: boolean }
    }

    expect(Array.isArray(data.shops)).toBe(true)
    expect(data.shops.length).toBeLessThanOrEqual(3)
    expect(data._meta).toMatchObject({ view: 'neighborhood-pulse-spotlight', read_only: true })

    for (const shop of data.shops) {
      expect(shop.slug).toBeTruthy()
      expect(shop.name).toBeTruthy()
      expect(shop.tagline).toBeTruthy()
      expect(shop.colonia).toBeTruthy()
      expect(Number.isFinite(shop.spotlight_score)).toBe(true)
    }
  })
})
