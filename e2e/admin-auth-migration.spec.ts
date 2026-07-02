import { test, expect } from '@playwright/test'

/**
 * Admin consolidation · Sprint 2.3 — auth migration gate.
 *
 * Every `/api/admin/*` route is now Clerk-only (`withAdmin`): the legacy
 * `?secret=` / `x-admin-secret` acceptance for humans is retired. The `api`
 * project runs ANONYMOUS, so each route must 401 — and, critically, a request
 * carrying the OLD secret must ALSO 401 (proving the secret arm is gone).
 *
 * `ADMIN_SECRET` survives only on documented MACHINE paths: `/api/admin/import`
 * (Bearer batch), the PDF render path, and — restored after S2.3 unintentionally
 * revoked it — the `/api/supply/*` importer surface (`withSupplyAdmin`, per
 * SUPPLY_IMPORT_SCHEMA.md). Supply therefore gets its OWN block below: it must
 * still 401 anonymously AND on a WRONG secret (no fail-open), but a correct
 * secret is honoured (the positive path needs the real secret + a running
 * importer, so it lives in the importer smoke, not this anonymous gate).
 *
 * A junk secret is used so that even if ADMIN_SECRET were set in the test env,
 * these assertions hold — a wrong secret never grants access.
 */

const JUNK = 'not-a-real-secret-value'

// Representative Clerk-only admin routes across every migrated surface (print,
// coupons, referrals, domain-coupon, scrape, runs). Supply is dual-auth — see
// the separate block below.
const GET_ROUTES = [
  '/api/admin/print/editions',
  '/api/admin/print/providers',
  '/api/admin/print/social',
  '/api/admin/coupons',
  '/api/admin/referrals/config',
  '/api/admin/domain-coupon',
  '/api/admin/runs',
]

// Supply importer surface (`withSupplyAdmin`): a CORRECT ADMIN_SECRET is honoured
// (machine path), but anonymous and wrong-secret requests must still 401.
const SUPPLY_GET_ROUTES = [
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

})

test.describe('supply importer auth · anonymous & wrong-secret rejected (no fail-open)', () => {
  for (const route of SUPPLY_GET_ROUTES) {
    test(`GET ${route} → 401 (no Clerk session, no secret)`, async ({ request }) => {
      const res = await request.get(route)
      expect(res.status()).toBe(401)
    })

    test(`GET ${route}?secret=<wrong> → 401 (wrong secret never grants access)`, async ({ request }) => {
      const res = await request.get(`${route}?secret=${JUNK}`)
      expect(res.status()).toBe(401)
    })

    test(`GET ${route} with wrong x-admin-secret → 401`, async ({ request }) => {
      const res = await request.get(route, { headers: { 'x-admin-secret': JUNK } })
      expect(res.status()).toBe(401)
    })
  }

  test('POST /api/supply/batches → 401 (anonymous, no secret)', async ({ request }) => {
    const res = await request.post('/api/supply/batches', { data: { name: 'spec batch' } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/supply/listing-images → 401 (anonymous, no secret)', async ({ request }) => {
    const res = await request.post('/api/supply/listing-images', {
      data: { product_id: 'prod_x', images: [{ url: 'https://example.com/a.jpg' }] },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/supply/listing-images?secret=<wrong> → 401', async ({ request }) => {
    const res = await request.post('/api/supply/listing-images?secret=not-a-real-secret-value', {
      data: { product_id: 'prod_x', images: [{ url: 'https://example.com/a.jpg' }] },
    })
    expect(res.status()).toBe(401)
  })
})
