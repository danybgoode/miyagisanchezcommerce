import { test, expect } from '@playwright/test'

/**
 * Cloudflare WAF/bot parity with the retired Vercel Bot Protection
 * (09-platform-infra frontend-vercel-to-cloudrun, Sprint 2, Story 2.3).
 *
 * NOT part of the CI gate — the `staging` Playwright project (see playwright.config.ts) excludes
 * `*.staging.spec.ts` from `api` for exactly this reason: it targets `gcp.miyagisanchez.com`
 * specifically, same reasoning as `origin-header-passthrough.staging.spec.ts`. Run manually:
 *
 *   PLAYWRIGHT_BASE_URL=https://gcp.miyagisanchez.com npx playwright test --project=staging edge-bot-mitigation
 *
 * Cloned from `not-found-shape.spec.ts`'s request-fixture pattern, but asserting the EDGE
 * mitigation (Cloudflare's own block page, confirmed live via its "Attention Required! |
 * Cloudflare" title + `server: cloudflare` header — there is no Vercel-style
 * `x-vercel-mitigated` equivalent custom header on a free-plan WAF block response, so the title +
 * server header are the verified, live-confirmed evidence), not the app's own 404 shape.
 */

test.describe('gcp.miyagisanchez.com — Cloudflare WAF edge mitigation (parity with Vercel Bot Protection)', () => {
  test('a classic probe path is blocked AT THE EDGE, never reaches the app', async ({ request }) => {
    const res = await request.get('/l/wp-admin', { maxRedirects: 0 })
    expect(res.status()).toBe(403)
    expect(res.headers()['server']).toBe('cloudflare')
    expect(await res.text()).toContain('Cloudflare')
  })

  test('a legitimate path is NOT over-blocked by the same rule', async ({ request }) => {
    const res = await request.get('/')
    expect(res.status()).toBe(200)
  })
})
