import { test, expect } from '@playwright/test'
import { buildFeaturedPatch } from '../lib/admin/featured'

/**
 * Homepage Selección · Sprint 2 — the admin "feature a product" write.
 *  - `buildFeaturedPatch` is the pure validation seam (no auth/network), proven here.
 *  - The two `/api/admin/seleccion*` routes are Clerk-only (`withAdmin`); the `api`
 *    project runs ANONYMOUS, so both must 401. The authed write needs an admin Clerk
 *    session (it mutates Medusa product metadata) and is owed to Daniel.
 */

test.describe('home-seleccion · buildFeaturedPatch (pure)', () => {
  test('pin with a rank → integer rank kept', () => {
    expect(buildFeaturedPatch({ featured: true, featured_rank: 2 })).toEqual({ featured: true, featured_rank: 2 })
  })

  test('pin without a rank → null rank (falls back to fresh order)', () => {
    expect(buildFeaturedPatch({ featured: true })).toEqual({ featured: true, featured_rank: null })
    expect(buildFeaturedPatch({ featured: true, featured_rank: null })).toEqual({ featured: true, featured_rank: null })
  })

  test('unpin always clears the rank (stale rank is dead weight)', () => {
    expect(buildFeaturedPatch({ featured: false, featured_rank: 5 })).toEqual({ featured: false, featured_rank: null })
  })

  test('a fractional rank is floored', () => {
    expect(buildFeaturedPatch({ featured: true, featured_rank: 3.9 })).toEqual({ featured: true, featured_rank: 3 })
  })

  test('rejects a missing/non-boolean featured', () => {
    expect(buildFeaturedPatch({})).toHaveProperty('error')
    expect(buildFeaturedPatch({ featured: 'yes' })).toHaveProperty('error')
    expect(buildFeaturedPatch(null)).toHaveProperty('error')
    expect(buildFeaturedPatch('nope')).toHaveProperty('error')
  })

  test('rejects a non-numeric / negative rank on a pin', () => {
    expect(buildFeaturedPatch({ featured: true, featured_rank: 'abc' })).toHaveProperty('error')
    expect(buildFeaturedPatch({ featured: true, featured_rank: -1 })).toHaveProperty('error')
  })

  test('never COERCES a string/boolean rank into a number', () => {
    // Number('2') → 2, Number(true) → 1, Number('') → 0 — all must be rejected, not admitted.
    expect(buildFeaturedPatch({ featured: true, featured_rank: '2' })).toHaveProperty('error')
    expect(buildFeaturedPatch({ featured: true, featured_rank: true })).toHaveProperty('error')
    expect(buildFeaturedPatch({ featured: true, featured_rank: '' })).toHaveProperty('error')
  })
})

test.describe('home-seleccion · admin API auth gate (anonymous)', () => {
  test('GET /api/admin/seleccion → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/seleccion')
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/admin/seleccion/:id → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.patch('/api/admin/seleccion/prod_test', {
      data: { featured: true, featured_rank: 1 },
    })
    expect(res.status()).toBe(401)
  })
})
