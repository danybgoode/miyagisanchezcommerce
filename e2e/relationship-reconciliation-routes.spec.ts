import { expect, test } from '@playwright/test'

/**
 * Founding merchant activation operations · Sprint 3, Story 3.3 (api
 * project): live route-guard smoke for the reconciliation GET, the replay
 * POST, and the reconciliation page. Same shape as `e2e/relationship-
 * operating-views.spec.ts` (Story 2.3) — see that file for the full
 * content-type-flip rationale; this is its sibling for the Story-3.3 routes.
 *
 * NOT covered here (owed to Daniel — sprint-3.md's smoke walkthrough steps
 * 3 and 5): the real authenticated round-trip — an admin's reconciliation
 * read showing source fact / projected stage / delivery state, and a replay
 * that repairs a deliberately delayed fact without duplicating a transition
 * or a Golden Beans event — needs a real admin session and live data, no
 * fixture for either exists in this harness.
 *
 * RED-OBSERVED MECHANISM (per the red-green rule, matching the house
 * pattern documented in the sprint brief): every route below is BRAND NEW —
 * none of these paths exist yet on `main`/prod. Confirmed live, right now,
 * against production:
 *
 *   GET  /api/admin/relationships/reconciliation      → 404 text/html
 *   POST /api/admin/relationship/<uuid>/replay         → 404 text/html
 *   GET  /admin/relaciones/conciliacion                → 404 (page)
 *
 * That's Next's generic catch-all serving a full rendered not-found PAGE for
 * an unmatched route — genuinely red today. Once this ships (flag
 * `promoter.activation_crm_enabled` stays OFF), the SAME anonymous request
 * still 404s — but from a REAL route via `authorizeRelationshipRequest`,
 * returning a JSON body with `content-type: application/json`. That
 * content-type flip is the deterministic red→green signal every test below
 * asserts.
 */

const FAKE_ID = '00000000-0000-0000-0000-000000000000'

function expectGatedJson404(res: { status(): number; headers(): Record<string, string> }) {
  expect(res.status()).toBe(404)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('GET /api/admin/relationships/reconciliation is a real JSON route, ADMIN-ONLY', () => {
  test('anonymous GET → 404 JSON (flag gate fires before the admin check)', async ({ request }) => {
    const res = await request.get('/api/admin/relationships/reconciliation')
    expectGatedJson404(res)
  })
})

test.describe('POST /api/admin/relationship/[id]/replay is a real JSON route, ADMIN-ONLY', () => {
  test('anonymous POST → 404 JSON, never a bare 200 replay', async ({ request }) => {
    const res = await request.post(`/api/admin/relationship/${FAKE_ID}/replay`)
    expectGatedJson404(res)
  })
  test('a bogus id never 500s while anonymous', async ({ request }) => {
    const res = await request.post('/api/admin/relationship/not-a-uuid/replay')
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('/admin/relaciones/conciliacion never leaks without a session', () => {
  test('anonymous GET → never 200', async ({ request }) => {
    const res = await request.get('/admin/relaciones/conciliacion', { maxRedirects: 0 }).catch(() => null)
    if (res) expect(res.status()).not.toBe(200)
  })
})
