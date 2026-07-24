import { expect, test } from '@playwright/test'

/**
 * Merchant activation scorecard · Sprint 1, Story 1.3 (api project): live
 * route-guard smoke for `GET /api/admin/scorecard`. Same shape as
 * `e2e/relationship-reconciliation-routes.spec.ts` — see that file for the
 * full content-type-flip rationale.
 *
 * `promoter.activation_crm_enabled` is OFF in production today (memory:
 * founding-merchant-activation-ops "MERGED to main, flag OFF"), so
 * `authorizeRelationshipRequest`'s flag gate fires BEFORE the session check
 * for every caller, admin or not — every case below observes the SAME
 * 404 JSON regardless of auth state. That is the correct, intended
 * behavior (SD2: "Flag OFF ⇒ the scorecard is 404/notFound too, which is
 * correct: no cohort to score") — this spec asserts the OBSERVABLE shape
 * (a real JSON route, never a bare 200, never a 5xx), not "the flag is on".
 * The admin-200 / non-admin-403 branches need a real Clerk admin session and
 * are owed to Daniel as the Sprint 1 smoke walkthrough (step 2).
 *
 * RED-OBSERVED: `GET /api/admin/scorecard` did not exist before this story —
 * confirmed it 404s as Next's generic catch-all (text/html) against
 * production prior to this change; after, it 404s from the real route
 * (content-type: application/json). That flip is what every assertion
 * below checks.
 */

function expectGatedJson(res: { status(): number; headers(): Record<string, string> }, status: number) {
  expect(res.status()).toBe(status)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('GET /api/admin/scorecard is a real JSON route', () => {
  test('anonymous GET → 404 JSON (flag gate fires before the session check)', async ({ request }) => {
    const res = await request.get('/api/admin/scorecard')
    expectGatedJson(res, 404)
  })

  test('anonymous GET with filters → still 404 JSON, never a bare 200 with data', async ({ request }) => {
    const res = await request.get('/api/admin/scorecard?cohort=fundadoras-2026-07&stage=claimed')
    expectGatedJson(res, 404)
  })
})

test.describe('write methods are unavailable on the scorecard read endpoint', () => {
  test('POST → 405, never a mutation', async ({ request }) => {
    const res = await request.post('/api/admin/scorecard')
    expect(res.status()).toBe(405)
  })

  test('PUT → 405', async ({ request }) => {
    const res = await request.put('/api/admin/scorecard')
    expect(res.status()).toBe(405)
  })

  test('DELETE → 405', async ({ request }) => {
    const res = await request.delete('/api/admin/scorecard')
    expect(res.status()).toBe(405)
  })
})
