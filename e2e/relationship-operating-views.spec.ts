import { expect, test } from '@playwright/test'

/**
 * Founding merchant activation operations · Sprint 2, Story 2.3 (api
 * project): live route-guard smoke for the admin correction route, both list
 * GETs, the row-detail history GET, and the two pages. Same shape as
 * `e2e/partner-grants.spec.ts` — see `e2e/relationship-stewardship.spec.ts`
 * (Story 2.2) for the full rationale; this file is its sibling for the
 * Story-2.3 routes.
 *
 * NOT covered here (owed to Daniel — sprint-2.md's smoke walkthrough): the
 * real authenticated round-trips — a promoter's scoped list, an admin's
 * filtered cohort, a stage correction with a reason and its 422-without-one
 * counterpart, and the cross-partner 403 on `/history` — need real bound
 * promoter + admin sessions, no fixture for either exists in this harness.
 *
 * RED-OBSERVED MECHANISM (stated for the PR, per the red-green rule): every
 * route below is BRAND NEW — none of these paths exist yet on `main`/prod.
 * Confirmed live, right now, against production:
 *
 *   POST /api/admin/relationship/<uuid>/correct-stage    → 404 text/html
 *   GET  /api/promoter/relationships                     → 404 text/html
 *   GET  /api/admin/relationships                        → 404 text/html
 *   GET  /api/promoter/relationship/<uuid>/history        → 404 text/html
 *
 * That's Next's generic catch-all serving a full rendered not-found PAGE for
 * an unmatched route — genuinely red today (confirmed: running this file
 * against production right now fails all four `expectGatedJson404`
 * assertions with `text/html` instead of `application/json`). Once this
 * ships (flag `promoter.activation_crm_enabled` stays OFF), the SAME
 * anonymous request still 404s — but from a REAL route via
 * `authorizeRelationshipRequest`, returning a JSON body with
 * `content-type: application/json`. That content-type flip is the
 * deterministic red→green signal every test below asserts.
 */

const FAKE_ID = '00000000-0000-0000-0000-000000000000'

function expectGatedJson404(res: { status(): number; headers(): Record<string, string> }) {
  expect(res.status()).toBe(404)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('correct-stage · POST /api/admin/relationship/[id]/correct-stage is a real JSON route, ADMIN-ONLY', () => {
  test('anonymous POST → 404 JSON (flag gate fires before the admin check ever runs)', async ({ request }) => {
    const res = await request.post(`/api/admin/relationship/${FAKE_ID}/correct-stage`, { data: { toStage: 'claimed', reason: 'prueba' } })
    expectGatedJson404(res)
  })
  test('a body missing reason never 500s while anonymous (the 422-without-reason branch is unreachable before the flag/auth gate, but the route must still degrade cleanly)', async ({ request }) => {
    const res = await request.post(`/api/admin/relationship/${FAKE_ID}/correct-stage`, { data: { toStage: 'claimed' } })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('GET /api/promoter/relationships is a real JSON route', () => {
  test('anonymous GET → 404 JSON, never a bare 200 list', async ({ request }) => {
    const res = await request.get('/api/promoter/relationships')
    expectGatedJson404(res)
  })
})

test.describe('GET /api/admin/relationships is a real JSON route, ADMIN-ONLY', () => {
  test('anonymous GET → 404 JSON (flag gate fires before the admin check)', async ({ request }) => {
    const res = await request.get('/api/admin/relationships')
    expectGatedJson404(res)
  })
  test('query-string filters never 500 while anonymous', async ({ request }) => {
    const res = await request.get('/api/admin/relationships?stage=claimed&blocker=true&missing_action=true&overdue=true')
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('GET /api/promoter/relationship/[id]/history is a real JSON route', () => {
  test('anonymous GET → 404 JSON, no history leaked', async ({ request }) => {
    const res = await request.get(`/api/promoter/relationship/${FAKE_ID}/history`)
    expectGatedJson404(res)
  })
})

test.describe('/promotor/relaciones and /admin/relaciones never leak without a session', () => {
  test('anonymous GET /promotor/relaciones → never 200 (flag off ⇒ 404; flag on ⇒ redirect to /sign-in)', async ({ request }) => {
    const res = await request.get('/promotor/relaciones', { maxRedirects: 0 }).catch(() => null)
    if (res) expect(res.status()).not.toBe(200)
  })
  test('anonymous GET /admin/relaciones → never 200', async ({ request }) => {
    const res = await request.get('/admin/relaciones', { maxRedirects: 0 }).catch(() => null)
    if (res) expect(res.status()).not.toBe(200)
  })
})
