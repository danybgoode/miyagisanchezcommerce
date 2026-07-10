import { test, expect } from '@playwright/test'

/**
 * UCP/MCP cutover checklist — staging companion (09-platform-infra
 * frontend-vercel-to-cloudrun, Sprint 3, Story 3.3).
 *
 * Same mechanism as ucp-cutover-api.spec.ts, run manually against the real edge path
 * (Cloudflare→ALB→Cloud Run) BEFORE the DNS cutover (Story 3.4), so any Host-header surprise
 * on the new infra is caught pre-flip rather than discovered live. NOT part of the CI gate —
 * the `staging` Playwright project (see playwright.config.ts) is scoped via
 * `testMatch: '**\/*.staging.spec.ts'`, so `--project=staging` alone already excludes
 * `ucp-cutover-api.spec.ts` (confirmed live: `--project=staging ucp-cutover` runs exactly this
 * file's 4 tests, not the sibling api spec's 9 — the project's testMatch does the filtering; the
 * "ucp-cutover" argument is just a convenience substring on top of that). Run manually:
 *
 *   PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com npx playwright test --project=staging ucp-cutover
 */

const EXPECTED_STAGING_HOST = 'gcp.miyagisanchez.com'

// Guard the guard: this file exists specifically to test the staging host, so a run accidentally
// pointed at prod (or anywhere else) must fail loud, not silently "pass" by validating whatever
// host it happened to be given (Codex cross-review finding, PR #203). Applies to every test in
// this file via beforeEach, not just the base_url one — the MCP/CORS tests would otherwise pass
// trivially against any host too.
test.beforeEach(async ({ baseURL }) => {
  test.skip(!baseURL, 'Run with PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com --project=staging (see header comment).')
  expect(new URL(baseURL!).hostname, `expected PLAYWRIGHT_BASE_URL to be ${EXPECTED_STAGING_HOST}`).toBe(EXPECTED_STAGING_HOST)
})

test.describe('gcp.miyagisanchez.com — UCP manifest advertises the staging origin correctly', () => {
  test('base_url matches gcp.miyagisanchez.com, not a dark *.run.app URL', async ({ request, baseURL }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
    const manifest = await res.json()
    expect(manifest.base_url).toBe(new URL(baseURL!).origin)
    expect(JSON.stringify(manifest)).not.toContain('run.app')
  })

  test('response carries cf-ray — genuinely transited Cloudflare, not a direct Cloud Run hit', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.headers()['cf-ray']).toBeTruthy()
  })
})

test.describe('gcp.miyagisanchez.com — MCP JSON-RPC round-trip through the full edge path', () => {
  test('tools/list responds correctly through Cloudflare→ALB→Cloud Run', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.result.tools)).toBeTruthy()
    expect(body.result.tools.length).toBeGreaterThan(0)
  })

  test('agent-origin CORS survives the new edge/ALB hop', async ({ request }) => {
    const res = await request.fetch('/api/ucp/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai' },
    })
    expect([200, 204]).toContain(res.status())
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })
})
