import { test, expect } from '@playwright/test'

/**
 * panfleto-premium-shop · Sprint 2, Story 2.1 — the rename itself is a live
 * Clerk-session action Daniel performs (no CLI/script/MCP tool exists for the
 * slug PATCH or the admin subdomain grant — see sprint-2.md "Your two
 * actions"), so this can't seed its own fixture. The underlying alias
 * PRECEDENCE logic is already fully covered, generically, by
 * `slug-redirect.spec.ts` (`pickAliasTarget`) — this spec does NOT duplicate
 * that. What it adds: a self-activating integration check for THIS specific
 * rename. It gracefully skips before Daniel does the rename (today's state)
 * and asserts the real behavior once he has — same shape as
 * `own-shop-seo.spec.ts`'s "positive path owed to Daniel" pattern, except
 * this one turns itself on rather than staying permanently skipped.
 *
 * The subdomain + mschz.org checks hit absolute cross-host URLs that only
 * make sense against production (a PR preview lives on a different host
 * entirely) — guarded to run only when PLAYWRIGHT_BASE_URL is unset/prod,
 * matching playwright.config.ts's own default.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://miyagisanchez.com'
const isProd = new URL(baseURL).host === 'miyagisanchez.com'

test.describe('panfleto rename — alias redirect', () => {
  test('/s/miyagiprints redirects in one hop to /mx/s/panfleto once renamed', async ({ request }) => {
    const res = await request.get('/s/miyagiprints?ref=QR', { maxRedirects: 0 })
    // Platform legacy paths use the market-cutover 308. Alias resolution must
    // be composed into that same response: `/mx/s/miyagiprints` as an
    // intermediate target would silently recreate a two-hop redirect chain.
    test.skip(res.status() !== 308, 'miyagiprints not renamed to panfleto in this environment yet')
    const location = res.headers()['location'] ?? ''
    const target = new URL(location, baseURL)
    expect(target.pathname).toBe('/mx/s/panfleto')
    expect(target.searchParams.get('ref')).toBe('QR')
  })
})

test.describe('panfleto rename — cross-host checks (production only)', () => {
  test('panfleto.miyagisanchez.com renders white-label once the subdomain is granted', async ({ request }) => {
    test.skip(!isProd, 'cross-host subdomain check only meaningful against production')
    const res = await request.get('https://panfleto.miyagisanchez.com', { maxRedirects: 0 })
    test.skip(res.status() !== 200, 'panfleto subdomain not granted/live in this environment yet')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('panfleto')
  })

  test('mschz.org/panfleto resolves to the canonical shop URL once renamed', async ({ request }) => {
    test.skip(!isProd, 'cross-host short-link check only meaningful against production')
    const res = await request.get('https://mschz.org/panfleto', { maxRedirects: 0 })
    const location = res.headers()['location'] ?? ''
    // An unresolved segment 301s to the branded /404, NOT a 404 status — so the
    // skip condition must key off the redirect TARGET, not the status code
    // (caught live: this test failed against today's un-renamed prod before
    // the fix, asserting against a real .../404 redirect instead of skipping).
    test.skip(res.status() !== 301 || location.includes('/404'), 'mschz.org/panfleto not resolving yet in this environment')
    expect(new URL(location).pathname).toBe('/mx/s/panfleto')
  })
})
