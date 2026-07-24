import { expect, test } from '@playwright/test'

/**
 * Merchant activation scorecard · Sprint 2, Story 2.3 (api project): live
 * route-guard smoke for `POST /api/admin/scorecard/mcp`. Same rationale as
 * `e2e/scorecard-endpoint-routes.spec.ts` — auth matches the read endpoint
 * exactly (`authorizeRelationshipRequest`), so the flag-OFF-in-production
 * 404 is the observable case for every caller today.
 *
 * RED-OBSERVED: this route did not exist before this story — 404s as
 * Next's generic catch-all today (text/html); the content-type flip to
 * application/json is what proves the real route once deployed.
 */

function expectGatedJson(res: { status(): number; headers(): Record<string, string> }, status: number) {
  expect(res.status()).toBe(status)
  expect(res.headers()['content-type'] ?? '').toContain('application/json')
}

test.describe('POST /api/admin/scorecard/mcp mirrors the read endpoint gate and never mutates', () => {
  test('anonymous tools/call → 404 JSON, no scorecard data leaked', async ({ request }) => {
    const res = await request.post('/api/admin/scorecard/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_activation_scorecard', arguments: {} } },
    })
    expectGatedJson(res, 404)
  })

  test('anonymous tools/list → 404 JSON', async ({ request }) => {
    const res = await request.post('/api/admin/scorecard/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expectGatedJson(res, 404)
  })

  test('a malformed body never gets past the auth gate as anonymous → still 404, never a 500', async ({ request }) => {
    const res = await request.post('/api/admin/scorecard/mcp', { data: 'not json', headers: { 'content-type': 'text/plain' } })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('the tool endpoint accepts POST only — no other method exists', () => {
  test('GET → 405', async ({ request }) => {
    const res = await request.get('/api/admin/scorecard/mcp')
    expect(res.status()).toBe(405)
  })

  test('PUT → 405', async ({ request }) => {
    const res = await request.put('/api/admin/scorecard/mcp')
    expect(res.status()).toBe(405)
  })

  test('DELETE → 405', async ({ request }) => {
    const res = await request.delete('/api/admin/scorecard/mcp')
    expect(res.status()).toBe(405)
  })
})
