import { test, expect } from '@playwright/test'

/**
 * Admin feature-flag write API · auth gate (epic 09 · feature-flags-inhouse, Sprint 2).
 * `GET/POST /api/admin/flags` are Clerk-only (`withAdmin`); the `api` project runs
 * ANONYMOUS, so every arm must 401 — including a POST with a perfectly valid body and a
 * POST with an unknown key, because auth is checked BEFORE the body is validated
 * (order = flag→auth→validate, per LEARNINGS: the 400 unknown-key path is proven in the
 * pure `flags-admin.spec.ts`, not here). A request carrying the retired URL/header secret
 * must ALSO 401. The authed 200-upsert + audit render is owed to Daniel (sprint smoke).
 */

const JUNK = 'not-a-real-secret-value'

test.describe('admin flags API · anonymous is rejected', () => {
  test('GET /api/admin/flags → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/flags')
    expect(res.status()).toBe(401)
  })

  test('POST with a valid body → 401 (auth precedes the upsert)', async ({ request }) => {
    const res = await request.post('/api/admin/flags', {
      data: { key: 'pdp_redesign', enabled: false },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with an unknown key → 401 (auth precedes validation, not 400)', async ({ request }) => {
    const res = await request.post('/api/admin/flags', {
      data: { key: 'made.up_flag', enabled: true },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with a retired ?secret= / x-admin-secret → still 401', async ({ request }) => {
    const bySecret = await request.post(`/api/admin/flags?secret=${JUNK}`, {
      data: { key: 'pdp_redesign', enabled: false },
    })
    expect(bySecret.status()).toBe(401)
    const byHeader = await request.post('/api/admin/flags', {
      headers: { 'x-admin-secret': JUNK },
      data: { key: 'pdp_redesign', enabled: false },
    })
    expect(byHeader.status()).toBe(401)
  })
})
