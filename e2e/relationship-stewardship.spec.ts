import { expect, test } from '@playwright/test'

/**
 * Founding merchant activation operations · Sprint 2, Story 2.2 (api project):
 * live route-guard smoke for the four stewardship write routes — interaction,
 * task, task/complete, owner reassignment. Same shape as
 * `e2e/partner-grants.spec.ts`: no pure decision logic lives directly in
 * these routes (the branchy logic is `lib/relationship-pipeline.ts`, covered
 * by its own zero-import spec) — what these routes need proven live is the
 * SHARED gate every one of them goes through (`authorizeRelationshipRequest`
 * / `resolveRelationshipAccess`).
 *
 * NOT covered here (owed to Daniel — sprint-2.md's smoke walkthrough): the
 * real authenticated round-trip (create an interaction, set/complete a task,
 * reassign an owner and see the history row) needs a real bound promoter
 * session — no fixture exists in this harness (the standing gap every
 * relationship/partner spec in this repo notes, going back to
 * `e2e/relationship-consent.spec.ts`).
 *
 * RED-OBSERVED MECHANISM (stated for the PR, per the red-green rule): every
 * route below is BRAND NEW — none of these paths exist yet on `main`/prod.
 * Confirmed live, right now, against production:
 *
 *   POST /api/promoter/relationship/<uuid>/interaction              → 404 text/html
 *   POST /api/promoter/relationship/<uuid>/task                     → 404 text/html
 *   POST /api/promoter/relationship/<uuid>/task/<uuid>/complete     → 404 text/html
 *   POST /api/promoter/relationship/<uuid>/owner                    → 404 text/html
 *
 * That's Next's generic catch-all serving a full rendered not-found PAGE for
 * an unmatched route — genuinely red today (confirmed: running this file
 * against production right now fails all four `expectGatedJson404`
 * assertions with `text/html` instead of `application/json`). Once this
 * ships (flag `promoter.activation_crm_enabled` stays OFF), the SAME
 * anonymous request still 404s — but from a REAL route via
 * `authorizeRelationshipRequest`, returning a JSON body with
 * `content-type: application/json`. That content-type flip is the
 * deterministic red→green signal every test below asserts — the exact
 * mechanism `e2e/partner-grants.spec.ts` already established for this repo.
 */

const FAKE_ID = '00000000-0000-0000-0000-000000000000'

function expectGatedJson404(res: { status(): number; headers(): Record<string, string> }) {
  expect(res.status()).toBe(404)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('interaction · POST /api/promoter/relationship/[id]/interaction is a real JSON route', () => {
  test('anonymous POST → 404 JSON (flag off), not the generic HTML 404 page', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/interaction`, { data: { kind: 'note', body: 'hola' } })
    expectGatedJson404(res)
  })
  test('a garbage body never 500s while anonymous (flag gate short-circuits first)', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/interaction`, { data: { kind: 123, body: {} } })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('task · POST /api/promoter/relationship/[id]/task is a real JSON route', () => {
  test('anonymous POST → 404 JSON', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/task`, { data: { title: 'Llamar el jueves' } })
    expectGatedJson404(res)
  })
  test('a garbage body never 500s while anonymous', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/task`, { data: { dueAt: 'no-es-una-fecha' } })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('task/complete · POST /api/promoter/relationship/[id]/task/[taskId]/complete is a real JSON route', () => {
  test('anonymous POST → 404 JSON', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/task/${FAKE_ID}/complete`)
    expectGatedJson404(res)
  })
})

test.describe('owner · POST /api/promoter/relationship/[id]/owner is a real JSON route', () => {
  test('anonymous POST → 404 JSON', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/owner`, { data: { toSteward: 'user_abc' } })
    expectGatedJson404(res)
  })
  test('a garbage body never 500s while anonymous', async ({ request }) => {
    const res = await request.post(`/api/promoter/relationship/${FAKE_ID}/owner`, { data: { toSteward: 12345 } })
    expect(res.status()).toBeLessThan(500)
  })
})
