import { test, expect } from '@playwright/test'

/**
 * Header-passthrough proof for the Cloudflare→ALB→Cloud Run staging path
 * (09-platform-infra frontend-vercel-to-cloudrun, Sprint 2, Story 2.2).
 *
 * NOT part of the CI gate — the `staging` Playwright project (see playwright.config.ts) excludes
 * `*.staging.spec.ts` from `api` for exactly this reason: it targets `gcp.miyagisanchez.com`
 * specifically, a different host than the Vercel preview CI runs against. Run manually:
 *
 *   PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com npx playwright test --project=staging origin-header-passthrough
 *
 * `middleware.ts` classifies every request purely off the `Host` header (confirmed by reading the
 * source — neither middleware.ts nor lib/channel.ts consumes X-Forwarded-For/-Proto today), so the
 * one thing that actually needs proving is: does `Host` reach the app unmodified through
 * Cloudflare→ALB→Cloud Run, and does the new PLATFORM_HOSTS entry make it resolve as the
 * marketplace channel instead of falling through to the custom-domain 404 path.
 *
 * What this does NOT assert (documented, not silently skipped — see sprint-2.md's smoke
 * walkthrough for the curl-based versions): a direct-to-LB-IP request being refused by Cloud
 * Armor (no raw-IP+SNI override in Playwright's `request` fixture) and X-Forwarded-Proto's exact
 * value (no app code consumes it today, so there's nothing to assert against).
 */

test.describe('gcp.miyagisanchez.com — Cloudflare→ALB→Cloud Run header passthrough', () => {
  test('Host reaches the app and resolves as the platform host, not a custom-domain 404', async ({ request }) => {
    const res = await request.get('/', { maxRedirects: 0 })
    expect(res.status()).toBe(200)
  })

  test('/api/health responds — the container itself is healthy independent of routing', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('response carries cf-ray — the request genuinely transited Cloudflare, not a direct hit', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.headers()['cf-ray']).toBeTruthy()
  })

  test('/api/ucp/manifest still serves correctly through the new path (UCP/MCP surface)', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.status()).toBe(200)
  })
})
