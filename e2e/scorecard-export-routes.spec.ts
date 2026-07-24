import { expect, test } from '@playwright/test'

/**
 * Merchant activation scorecard · Sprint 2, Story 2.2 (api project): live
 * route-guard smoke for `GET /api/admin/scorecard/export`. Same rationale
 * as `e2e/scorecard-endpoint-routes.spec.ts` (Story 1.3) — auth matches the
 * read endpoint exactly (`authorizeRelationshipRequest`), so the same
 * flag-OFF-in-production 404 is the observable case here too.
 *
 * RED-OBSERVED: this route did not exist before this story — 404s as Next's
 * generic catch-all today (text/html); the content-type flip to
 * application/json is what proves the real route once deployed.
 */

function expectGatedJson(res: { status(): number; headers(): Record<string, string> }, status: number) {
  expect(res.status()).toBe(status)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('GET /api/admin/scorecard/export mirrors the read endpoint gate', () => {
  test('anonymous GET → 404 JSON, never a CSV body', async ({ request }) => {
    const res = await request.get('/api/admin/scorecard/export')
    expectGatedJson(res, 404)
  })

  test('anonymous GET with filters → still 404 JSON', async ({ request }) => {
    const res = await request.get('/api/admin/scorecard/export?cohort=fundadoras-2026-07')
    expectGatedJson(res, 404)
  })
})

test.describe('write methods are unavailable on the export route', () => {
  test('POST → 405', async ({ request }) => {
    const res = await request.post('/api/admin/scorecard/export')
    expect(res.status()).toBe(405)
  })

  test('DELETE → 405', async ({ request }) => {
    const res = await request.delete('/api/admin/scorecard/export')
    expect(res.status()).toBe(405)
  })
})
