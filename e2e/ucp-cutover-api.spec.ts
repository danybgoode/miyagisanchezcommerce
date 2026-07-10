import { test, expect } from '@playwright/test'

/**
 * UCP/MCP cutover checklist (09-platform-infra frontend-vercel-to-cloudrun, Sprint 3, Story 3.3).
 *
 * `manifest`/`mcp`/`checkout-session` all derive their advertised base URL from
 * `req.headers.get('host')` (no env-var override) — correct by construction since Sprint 2.2
 * already proved Host-header passthrough works end-to-end through Cloudflare→ALB→Cloud Run, but
 * genuinely unasserted until now: no existing spec checked the manifest's `base_url` hostname,
 * only that routes return 200/valid shape. This spec is CI-safe against ANY host (Vercel preview,
 * gcp.miyagisanchez.com, prod) — every assertion is relative to Playwright's own `baseURL`
 * (`playwright.config.ts`), never a hardcoded literal domain, so it runs unchanged before and
 * after the cutover.
 */

// Matches the route's own proto derivation (app/api/ucp/manifest/route.ts: proto is 'http' only
// when host.includes('localhost'), 'https' otherwise) — so this holds for a plain `http://` or
// `https://` baseURL, including local dev (both sides derive proto from the same host string).
// It would only diverge on an artificial `https://localhost` baseURL, which no config in this
// repo ever sets.
function expectedOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'https://miyagisanchez.com').origin
}

test.describe('UCP manifest — advertises the canonical origin, not a dark *.run.app URL', () => {
  test('base_url matches this test\'s own origin', async ({ request, baseURL }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
    const manifest = await res.json()
    expect(manifest.base_url).toBe(expectedOrigin(baseURL))
  })

  test('no URL anywhere in the manifest points at a *.run.app host', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('run.app')
  })

  test('every endpoint URL shares the same origin as base_url', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
    const manifest = await res.json()
    const urls: string[] = Object.values(manifest.endpoints as Record<string, { url?: string }>)
      .map((e) => e.url)
      .filter((u): u is string => typeof u === 'string')
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(new URL(url).origin).toBe(manifest.base_url)
    }
  })

  test('OPTIONS carries wildcard CORS for agent origins', async ({ request }) => {
    const res = await request.fetch('/api/ucp/manifest', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai' },
    })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })
})

test.describe('UCP MCP — JSON-RPC round-trip + agent CORS', () => {
  test('tools/list returns a non-empty tool catalog', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(Array.isArray(body.result.tools)).toBeTruthy()
    expect(body.result.tools.length).toBeGreaterThan(0)
  })

  test('initialize\'s serverInfo has no stray host reference', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'initialize' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result.serverInfo).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('run.app')
  })

  test('OPTIONS carries wildcard CORS for agent origins', async ({ request }) => {
    const res = await request.fetch('/api/ucp/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai' },
    })
    expect([200, 204]).toContain(res.status())
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })
})

test.describe('UCP checkout-session — checkout_url origins (fixture-gated)', () => {
  const LISTING_ID = process.env.MS_TEST_PDP_LISTING_ID || process.env.MS_TEST_PERSONALIZED_LISTING_ID

  test('every checkout_url shares this test\'s own origin, never *.run.app', async ({ request, baseURL }) => {
    test.skip(!LISTING_ID, 'Set MS_TEST_PDP_LISTING_ID (or MS_TEST_PERSONALIZED_LISTING_ID) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()
    expect(Array.isArray(session.payment_options)).toBeTruthy()
    expect(session.payment_options.length).toBeGreaterThan(0)

    const checkoutUrls: string[] = session.payment_options
      .map((o: { checkout_url?: string }) => o.checkout_url)
      .filter((u: string | undefined): u is string => typeof u === 'string')
    // At least one instant method (MP/Stripe) should be available on a normal fixture listing —
    // if this ever comes back empty, the fixture listing has no instant payment method configured
    // rather than the test silently having nothing to check.
    expect(checkoutUrls.length).toBeGreaterThan(0)

    for (const url of checkoutUrls) {
      expect(new URL(url).origin).toBe(expectedOrigin(baseURL))
      expect(url).not.toContain('run.app')
    }
  })

  test('OPTIONS carries wildcard CORS for agent origins', async ({ request }) => {
    const res = await request.fetch('/api/ucp/checkout-session', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai' },
    })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })
})
