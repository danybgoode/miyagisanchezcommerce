import { test, expect } from '@playwright/test'

/**
 * Admin tenant directory · S3.1 — auth gate. `GET /api/admin/tenants` is
 * Clerk-only (`withAdmin`); the `api` project runs ANONYMOUS, so it must 401 —
 * and a request carrying the old URL/header secret must ALSO 401 (the secret arm
 * was retired in S2.3). The authed 200-with-rows read needs an admin Clerk
 * session and is owed to Daniel (stated in the PR + sprint smoke).
 */

const JUNK = 'not-a-real-secret-value'

test.describe('admin tenants API · anonymous is rejected', () => {
  test('GET /api/admin/tenants → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/tenants')
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/tenants?secret=… → still 401 (URL secret retired)', async ({ request }) => {
    const res = await request.get(`/api/admin/tenants?secret=${JUNK}`)
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/tenants with x-admin-secret → still 401 (header secret retired)', async ({ request }) => {
    const res = await request.get('/api/admin/tenants', { headers: { 'x-admin-secret': JUNK } })
    expect(res.status()).toBe(401)
  })
})
