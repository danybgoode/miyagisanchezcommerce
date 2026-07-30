import { test, expect } from '@playwright/test'

/**
 * Own-shop experience — custom-domain white-label routing (epic 07 · own-shop-experience, sprint 1).
 *
 * The white-label storefront only renders when a request arrives on a tenant's
 * own domain — middleware resolves the shop from the `host` header and tags the
 * request with x-miyagi-channel/-domain/-shop-slug. Vercel previews/prod are
 * platform hosts (`*.vercel.app` / miyagisanchez.com) and cannot be reached by a
 * foreign Host, so the hostname path itself is verified by Daniel against a live
 * custom domain post-merge.
 *
 * What IS verifiable here (and what this guards):
 *  1. No regression — the Mexico marketplace homepage still renders platform
 *     chrome after the middleware rewrite→passthrough refactor.
 *  2. A legacy platform shop URL enters the canonical market namespace in one
 *     hop. Header-spoof requests are not a useful black-box trust proof because
 *     proxy/framework layers may independently strip those headers.
 *
 * Read-only — no mutations.
 */

// Search box lives ONLY in the platform header, never in the white-label
// ChannelLayout — so it's a reliable "platform chrome is present" marker.
const PLATFORM_CHROME_MARKER = '¿Qué estás buscando?'

test.describe('Own-shop — custom-domain channel routing', () => {
  test('Mexico marketplace homepage still renders platform chrome (no regression)', async ({ request }) => {
    const res = await request.get('/mx')
    expect(res.ok()).toBeTruthy()
    expect(await res.text()).toContain(PLATFORM_CHROME_MARKER)
  })

  test('legacy platform shop URL redirects straight into the Mexico market namespace', async ({ request }) => {
    const res = await request.get('/s/legacy-shop-guard?ref=channel', { maxRedirects: 0 })
    expect(res.status()).toBe(308)
    // Next may emit an origin-relative Location locally and an absolute one on
    // preview/prod; URL-with-base normalizes both forms.
    const location = new URL(res.headers()['location'], 'https://miyagisanchez.com')
    expect(location.pathname).toBe('/mx/s/legacy-shop-guard')
    expect(location.search).toBe('?ref=channel')
  })
})
