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

/**
 * FLAG-STATE DRIFT REPAIR (merchant-partner-lifecycle S1, 2026-07-24) — this
 * helper asserted `toBe(status)` on a pinned 404, which was correct when this
 * file was written (`promoter.activation_crm_enabled` was OFF, so the shared
 * `authorizeRelationshipRequest` gate 404'd before Clerk ever ran) and became
 * WRONG the moment Daniel flipped that flag ON in production: the anonymous
 * request now reaches the Clerk check and gets a 401. Verified live 2026-07-24:
 *
 *   GET https://miyagisanchez.com/api/admin/scorecard → 401 application/json
 *
 * Every test in this file was failing against prod on `main`, for a reason that
 * is not a bug — the exact same drift, from the exact same flag flip, that hit
 * the three `e2e/relationship-*.spec.ts` route-guard specs.
 *
 * Repaired to the flag-state-AGNOSTIC form `e2e/partner-grants.spec.ts` already
 * uses: 401 or the gated status, but always a GENUINE JSON response. The
 * red→green signal this file documents is fully preserved — it was never the
 * status code, it was the `content-type` flip from Next's generic HTML
 * not-found page to a real route's JSON body. A pinned status ADDITIONALLY
 * asserted a flag state, which a spec has no business pinning: the flag is
 * Daniel's to flip, and flipping it must not turn the suite red.
 */
function expectGatedJson(res: { status(): number; headers(): Record<string, string> }, status: number) {
  expect([401, status]).toContain(res.status())
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
