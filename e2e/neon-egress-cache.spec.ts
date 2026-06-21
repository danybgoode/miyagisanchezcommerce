import { test, expect } from '@playwright/test'
import { CACHE, storefrontCacheControl } from '../lib/cache-policy'

/**
 * Cache-policy guard (epic 09 · neon-egress-and-db-isolation S1.2).
 *
 * The storefront read windows used to be scattered magic numbers; they now live in one documented
 * SSOT (`lib/cache-policy.ts`) so an uncached read can't quietly cascade FE → Cloud Run → Neon and burn
 * the org's 5 GB/mo transfer cap. Part 1 is pure (no network) — it pins the windows + the
 * Cache-Control builder so a future edit can't silently widen/break them. Part 2 confirms the policy is
 * actually emitted on a real anonymous, edge-cacheable read route (the UCP agent catalog).
 */

test.describe('cache-policy · windows + builder (pure)', () => {
  test('the documented storefront windows are stable', () => {
    expect(CACHE.LISTING).toBe(60) // PDP / single listing — price+stock current within ~1 min
    expect(CACHE.SHOP).toBe(120) // shop identity — changes rarely
    expect(CACHE.CATALOG).toBe(30) // search / agent catalog — freshest discovery
    expect(CACHE.CATEGORY).toBe(300) // coarse category counts — tolerant of lag
  })

  test('storefrontCacheControl builds public s-maxage + 2× stale-while-revalidate', () => {
    expect(storefrontCacheControl(60)).toBe('public, s-maxage=60, stale-while-revalidate=120')
    expect(storefrontCacheControl(CACHE.CATALOG)).toBe('public, s-maxage=30, stale-while-revalidate=60')
  })
})

test.describe('cache-policy · emitted on the anonymous catalog route (live)', () => {
  // Vercel CONSUMES `s-maxage` at the edge and collapses the client-facing `Cache-Control` of a route
  // handler to just `public` (the pure test above pins the exact s-maxage the app sends). So the
  // client-observable proof is: the deployed route is PUBLICLY edge-cacheable — `public`, never
  // `no-store`/`private` — and it goes through Vercel's edge cache (an `x-vercel-cache` verdict). A
  // personalized/dynamic read would instead show `private, no-store`.
  test('GET /api/ucp/catalog is publicly edge-cacheable (not no-store)', async ({ request }) => {
    const res = await request.get('/api/ucp/catalog?limit=1')
    expect(res.ok()).toBeTruthy()
    const cc = res.headers()['cache-control'] ?? ''
    // Environment-independent proof: the route is publicly cacheable, never per-user/no-store.
    expect(cc).toContain('public')
    expect(cc).not.toMatch(/no-store|private/)
    // On Vercel the edge cache adds an `x-vercel-cache` verdict — confirm it's a real cache verdict when
    // present. It's absent on a local/non-Vercel `next start`, so don't REQUIRE it (the gate runs vs the
    // Vercel preview, where it's present; this keeps the spec from false-failing on a local run).
    const verdict = res.headers()['x-vercel-cache']
    if (verdict) expect(verdict).toMatch(/HIT|MISS|STALE|BYPASS|PRERENDER|REVALIDATED/i)
  })
})
