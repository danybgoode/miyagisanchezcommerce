import { test, expect } from '@playwright/test'

/**
 * UCP/MCP cutover checklist — staging companion (09-platform-infra
 * frontend-vercel-to-cloudrun, Sprint 3, Story 3.3).
 *
 * Same mechanism as ucp-cutover-api.spec.ts, run manually against the real edge path
 * (Cloudflare→ALB→Cloud Run) BEFORE the DNS cutover (Story 3.4), so any Host-header surprise
 * on the new infra is caught pre-flip rather than discovered live. NOT part of the CI gate —
 * the `staging` Playwright project (see playwright.config.ts) excludes `*.staging.spec.ts` from
 * `api` for exactly this reason (it targets a deliberately different host). Run manually:
 *
 *   PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com npx playwright test --project=staging ucp-cutover
 */

test.describe('gcp.miyagisanchez.com — UCP manifest advertises the staging origin correctly', () => {
  test('base_url matches gcp.miyagisanchez.com, not a dark *.run.app URL', async ({ request, baseURL }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
    const manifest = await res.json()
    expect(manifest.base_url).toBe(new URL(baseURL ?? '').origin)
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
