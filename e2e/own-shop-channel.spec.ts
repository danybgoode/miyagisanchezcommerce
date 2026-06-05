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
 *  1. No regression — the marketplace homepage still renders platform chrome
 *     after the middleware rewrite→passthrough refactor.
 *  2. The trust headers are spoof-proof — sending x-miyagi-channel:custom to the
 *     platform host must NOT drop platform chrome (middleware strips inbound
 *     x-miyagi-* on platform hosts; only middleware may set them).
 *
 * Read-only — no mutations.
 */

// Search box lives ONLY in the platform header, never in the white-label
// ChannelLayout — so it's a reliable "platform chrome is present" marker.
const PLATFORM_CHROME_MARKER = '¿Qué estás buscando?'

test.describe('Own-shop — custom-domain channel routing', () => {
  test('marketplace homepage still renders platform chrome (no regression)', async ({ request }) => {
    const res = await request.get('/')
    expect(res.ok()).toBeTruthy()
    expect(await res.text()).toContain(PLATFORM_CHROME_MARKER)
  })

  test('spoofed channel headers do NOT trigger white-label on the platform host', async ({ request }) => {
    const res = await request.get('/', {
      headers: {
        'x-miyagi-channel': 'custom',
        'x-miyagi-domain': 'attacker.example',
        'x-miyagi-shop-slug': 'panuchas',
      },
    })
    expect(res.ok()).toBeTruthy()
    // Trust headers are stripped on platform hosts → platform chrome survives.
    expect(await res.text()).toContain(PLATFORM_CHROME_MARKER)
  })
})
