import { test, expect } from '@playwright/test'

/**
 * `/api/sell/tenant-intake` · auth gate (onboarding three-doors epic,
 * Sprint 1 · Story 1.1). Clerk-gated; the `api` project runs ANONYMOUS, so
 * every arm must 401 — including a well-formed body, since auth is checked
 * before the body is read (same discipline as
 * `admin-content-overrides-api.spec.ts`). The authed GET/POST round-trip
 * (a real Clerk session) is owed to Daniel per the Sprint 1 smoke
 * walkthrough.
 */

test.describe('tenant-intake API · anonymous is rejected', () => {
  test('GET /api/sell/tenant-intake → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/sell/tenant-intake')
    expect(res.status()).toBe(401)
  })

  test('POST with valid Q1/Q2 answers → 401 (auth precedes the write)', async ({ request }) => {
    const res = await request.post('/api/sell/tenant-intake', {
      data: { sells: ['product'], sellsWhere: ['mercado_libre'] },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with a door selection → 401 (auth precedes the write)', async ({ request }) => {
    const res = await request.post('/api/sell/tenant-intake', {
      data: { chosenDoor: 'agent' },
    })
    expect(res.status()).toBe(401)
  })
})
