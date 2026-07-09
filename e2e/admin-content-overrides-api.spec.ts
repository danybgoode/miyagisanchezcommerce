import { test, expect } from '@playwright/test'

/**
 * Admin copy-override write API · auth gate (epic 08 · admin-content-and-announcements,
 * Sprint 1). `GET/POST/DELETE /api/admin/content-overrides` are Clerk-only
 * (`withAdmin`); the `api` project runs ANONYMOUS, so every arm must 401 —
 * including a POST/DELETE with a perfectly well-formed body, because auth is
 * checked BEFORE the body is validated (order = auth→validate, per LEARNINGS: the
 * 400 unknown-key / non-bilingual-en paths are proven in the pure
 * `copy-overrides-admin.spec.ts`, not here). The authed 200-upsert + live-render
 * round-trip is owed to Daniel (sprint smoke).
 */

test.describe('admin content-overrides API · anonymous is rejected', () => {
  test('GET /api/admin/content-overrides → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/content-overrides')
    expect(res.status()).toBe(401)
  })

  test('POST with a valid body → 401 (auth precedes the upsert)', async ({ request }) => {
    const res = await request.post('/api/admin/content-overrides', {
      data: { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'x' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with an unknown key → 401 (auth precedes validation, not 400)', async ({ request }) => {
    const res = await request.post('/api/admin/content-overrides', {
      data: { namespace: 'sellerAcquisition', key: 'made.up.key', locale: 'es', value: 'x' },
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE with a valid body → 401 (auth precedes the delete)', async ({ request }) => {
    const res = await request.delete('/api/admin/content-overrides', {
      data: { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es' },
    })
    expect(res.status()).toBe(401)
  })
})
