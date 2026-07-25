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
