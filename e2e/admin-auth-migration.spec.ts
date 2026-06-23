import { test, expect } from '@playwright/test'

/**
 * Admin consolidation · Sprint 2.3 — auth migration gate.
 *
 * Every `/api/admin/*` + `/api/supply/*` route is now Clerk-only (`withAdmin`):
 * the legacy `?secret=` / `x-admin-secret` acceptance for humans is retired. The
 * `api` project runs ANONYMOUS, so each route must 401 — and, critically, a
 * request carrying the OLD secret must ALSO 401 (proving the secret arm is gone).
 *
 * `ADMIN_SECRET` survives only on documented MACHINE paths (out of scope here):
 * `/api/admin/import` (Bearer batch) and the PDF render path. The full authed
 * 200-with-session sweep across every section is owed to Daniel (he holds the
 * admin Clerk session) — stated in the PR.
 *
 * A junk secret is used so that even if ADMIN_SECRET were somehow set in the
 * test env, this asserts the route no longer honours a URL/header secret.
 */

const JUNK = 'not-a-real-secret-value'

// Representative routes across every migrated surface (print, coupons,
// referrals, domain-coupon, scrape, runs, supply).
const GET_ROUTES = [
  '/api/admin/print/editions',
  '/api/admin/print/providers',
  '/api/admin/print/social',
  '/api/admin/coupons',
  '/api/admin/referrals/config',
  '/api/admin/domain-coupon',
  '/api/admin/runs',
  '/api/supply/batches',
  '/api/supply/status',
  '/api/supply/schema',
]

test.describe('admin auth migration · anonymous is rejected', () => {
  for (const route of GET_ROUTES) {
    test(`GET ${route} → 401 (no Clerk session)`, async ({ request }) => {
      const res = await request.get(route)
      expect(res.status()).toBe(401)
    })

    test(`GET ${route}?secret=… → still 401 (URL secret retired)`, async ({ request }) => {
      const res = await request.get(`${route}?secret=${JUNK}`)
      expect(res.status()).toBe(401)
    })

    test(`GET ${route} with x-admin-secret → still 401 (header secret retired)`, async ({ request }) => {
      const res = await request.get(route, { headers: { 'x-admin-secret': JUNK } })
      expect(res.status()).toBe(401)
    })
  }

  test('PATCH /api/admin/referrals/config → 401 (mutations gated too)', async ({ request }) => {
    const res = await request.patch('/api/admin/referrals/config', { data: { enabled: false } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/supply/batches → 401', async ({ request }) => {
    const res = await request.post('/api/supply/batches', { data: { name: 'spec batch' } })
    expect(res.status()).toBe(401)
  })
})
