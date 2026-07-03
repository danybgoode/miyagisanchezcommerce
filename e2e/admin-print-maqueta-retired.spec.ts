import { test, expect } from '@playwright/test'

/**
 * Maqueta builder deprecation (epic zine-editing-central, Story 3.1) — the
 * interactive layout editor at `/admin/print/:id/builder` is retired in favor
 * of the zine studio (a separate local-only app). The route must never 404;
 * it redirects forward with a notice param instead. The print/export pipeline
 * (`.../print`, `.../pdf`, `.../export`) and the rest of `/admin/print` (editions,
 * tiers, providers, submissions queue) are untouched by this story and keep
 * their existing Clerk-gate behavior (anonymous → redirect to `/`).
 */

test.describe('admin print · Maqueta builder retired', () => {
  test('GET /admin/print/:id/builder redirects to /admin/print with the zine notice, never 404s', async ({ request }) => {
    const res = await request.get('/admin/print/does-not-exist/builder', { maxRedirects: 0 })
    expect([307, 308]).toContain(res.status())
    const location = res.headers()['location'] ?? ''
    expect(location).toContain('/admin/print')
    expect(location).toContain('notice=zine-maqueta')
  })

  test('GET /admin/print still resolves (anonymous → Clerk gate redirect, not a crash)', async ({ request }) => {
    const res = await request.get('/admin/print', { maxRedirects: 0 })
    expect([200, 307, 308]).toContain(res.status())
  })
})
