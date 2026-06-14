import { test, expect } from '@playwright/test'
import { isLikelyListingId, isLikelyShopSlug } from '../lib/route-shape'

/**
 * Cheap-404 shape guard (epic 09 · vercel-function-cost-reduction S2.2).
 *
 * Scanners hammering dead/junk `/l/[id]` + `/s/[slug]` URLs were the #1 source
 * of `/_not-found` function invocations + Fluid Active CPU — each paying a full
 * Medusa fetch before 404ing. The fix: a pure, edge-safe shape predicate
 * (lib/route-shape.ts) lets middleware 404 a clearly-malformed URL with a cache
 * header BEFORE the page function is invoked, and the page guards short-circuit
 * before any getListing/getShop fetch as defense-in-depth.
 *
 * Part 1 is pure (no network) — the shape rules. Part 2 hits the deployed
 * preview/prod to confirm junk URLs 404 via the cheap middleware path while a
 * well-formed-but-deleted id/slug still 404s through the page unchanged.
 */

test.describe('route-shape · isLikelyListingId', () => {
  test('accepts a real Medusa product id shape (prod_ + ULID)', () => {
    expect(isLikelyListingId('prod_01KTQY8PFAVCRRD61DNSXNXKM8')).toBe(true)
  })

  test('rejects every junk segment a scanner sends', () => {
    for (const junk of [
      'wp-admin', 'not-a-real-id', '.env', 'admin.php', '123', '',
      'prod_', 'prod_short', 'sel_01KTQY8PFAVCRRD61DNSXNXKM8', // wrong prefix/too short
      'prod_01KTQY8PFAVCRRD61DNSXNXKM8-extra-long-tail-xxxxxxxx',
    ]) {
      expect(isLikelyListingId(junk)).toBe(false)
    }
  })
})

test.describe('route-shape · isLikelyShopSlug', () => {
  test('accepts well-formed live + import-generated slugs (incl. >40 chars)', () => {
    for (const ok of [
      'mi-tienda', 'autos-seminuevos-puebla-seminuevosmex-g0ma',
      'alma-jalisco-restaurante-con-vista-a-la-catedral-ov3m', // 53 chars, real import slug
    ]) {
      expect(isLikelyShopSlug(ok)).toBe(true)
    }
  })

  test('rejects malformed slugs (uppercase, dots, underscores, edges, too short)', () => {
    for (const junk of [
      'WP-Login', '.env', 'wp_login', '-leading', 'trailing-', 'ab', '', 'a/b', 'café',
    ]) {
      expect(isLikelyShopSlug(junk)).toBe(false)
    }
  })

  test('rejects an absurdly long segment', () => {
    expect(isLikelyShopSlug('a'.repeat(200))).toBe(false)
  })
})

// The bare body middleware serves on the cheap path — distinct from the branded
// not-found.tsx ("Página no encontrada") that the page function would render.
const MIDDLEWARE_404 = 'Not found.'

test.describe('cheap 404 — junk listing/shop URLs short-circuit', () => {
  test('a junk listing URL 404s with a cache header, no page render', async ({ request }) => {
    const res = await request.get('/l/wp-admin', { maxRedirects: 0 })
    expect(res.status()).toBe(404)
    expect(res.headers()['cache-control'] ?? '').toContain('s-maxage')
    expect(await res.text()).toContain(MIDDLEWARE_404)
  })

  test('a junk shop URL (malformed shape) 404s with a cache header', async ({ request }) => {
    const res = await request.get('/s/Not-A-Real-Shop', { maxRedirects: 0 })
    expect(res.status()).toBe(404)
    expect(res.headers()['cache-control'] ?? '').toContain('s-maxage')
    expect(await res.text()).toContain(MIDDLEWARE_404)
  })

  test('a well-formed-but-nonexistent listing id still 404s through the page (not over-blocked)', async ({ request }) => {
    // Valid `prod_`-shape but no such product → passes the middleware shape gate,
    // reaches the page, getListing returns null → notFound(). Confirms we 404 the
    // *deleted* case cleanly without the bare middleware short-circuit.
    const res = await request.get('/l/prod_00000000000000000000000000', { maxRedirects: 0 })
    expect(res.status()).toBe(404)
    expect(await res.text()).not.toContain(MIDDLEWARE_404)
  })
})
