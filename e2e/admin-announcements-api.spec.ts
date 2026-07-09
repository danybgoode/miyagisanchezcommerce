import { test, expect } from '@playwright/test'

/**
 * Admin announcement write API · auth gate (epic 08 · admin-content-and-announcements,
 * Sprint 3). `GET/POST/DELETE /api/admin/announcements` are Clerk-only (`withAdmin`);
 * the `api` project runs ANONYMOUS, so every arm must 401 — including a well-formed
 * body, because auth is checked BEFORE the body is validated (order = auth→validate,
 * per LEARNINGS: the 400 validation paths are proven in the pure
 * `announcements-admin.spec.ts`, not here). The authed 200-write + activation-conflict
 * + live-render round-trip is owed to Daniel (sprint smoke).
 */

test.describe('admin announcements API · anonymous is rejected', () => {
  test('GET /api/admin/announcements → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/announcements')
    expect(res.status()).toBe(401)
  })

  test('POST with a valid body → 401 (auth precedes the write)', async ({ request }) => {
    const res = await request.post('/api/admin/announcements', {
      data: { audience: 'seller', text: 'x', active: true },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with an invalid body → 401 (auth precedes validation, not 400)', async ({ request }) => {
    const res = await request.post('/api/admin/announcements', {
      data: { audience: 'not-a-real-audience' },
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE with a valid body → 401 (auth precedes the delete)', async ({ request }) => {
    const res = await request.delete('/api/admin/announcements', {
      data: { id: 'a1' },
    })
    expect(res.status()).toBe(401)
  })
})
