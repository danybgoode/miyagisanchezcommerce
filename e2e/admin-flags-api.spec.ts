import { test, expect } from '@playwright/test'

/**
 * Admin flags API · flag-provider-mandate S2.1. `GET /api/admin/flags` is the Clerk-admin-gated
 * READ-ONLY Golden mirror (`withAdmin`); the `api` project runs ANONYMOUS, so it must 401.
 *
 * There is no write path at all: every write method answers 405 because no handler exists — for an
 * anonymous caller, a caller with a valid body, and a caller carrying the long-retired
 * `?secret=` / `x-admin-secret`. 405 (not 401) is the assertion: a 401 would mean a write handler
 * still exists behind auth. Flags change only in Golden's console.
 */

const JUNK = 'not-a-real-secret-value'
const BODY = { key: 'pdp_redesign', enabled: false, expectedSnapshotVersion: 1, reason: 'spec' }

test.describe('admin flags API · read-only mirror', () => {
  test('GET /api/admin/flags → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/flags')
    expect(res.status()).toBe(401)
  })

  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    test(`${method.toUpperCase()} → 405: the write path is gone, not hidden`, async ({ request }) => {
      const res = await request[method]('/api/admin/flags', { data: BODY })
      expect(res.status()).toBe(405)
    })
  }

  test('POST with a retired ?secret= / x-admin-secret → still 405', async ({ request }) => {
    const bySecret = await request.post(`/api/admin/flags?secret=${JUNK}`, { data: BODY })
    expect(bySecret.status()).toBe(405)
    const byHeader = await request.post('/api/admin/flags', {
      headers: { 'x-admin-secret': JUNK },
      data: BODY,
    })
    expect(byHeader.status()).toBe(405)
  })
})
