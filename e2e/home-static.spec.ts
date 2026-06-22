import { expect, test } from '@playwright/test'

/**
 * marketplace-static-shell S2 — the homepage is now a STATIC, de-personalized curated
 * shell for everyone. These anonymous `api` checks prove:
 *   • the curated content renders without auth (Selección / Categorías), and
 *   • the four signed-in modules are gone for EVERYONE (no server-side personalization
 *     in the render) — so the page can prerender to a CDN asset.
 * The `next build` static-marker check for `/` (no `ƒ`) is the load-bearing companion to
 * this spec; see sprint-2.md.
 */

const SIGNED_IN_MODULE_TESTIDS = [
  'home-retoma-rail',
  'home-offer-alert',
  'home-seller-snapshot',
  'home-seller-recruit',
]

test.describe('static homepage · curated shell, no personalization', () => {
  test('the four signed-in modules are absent for an anonymous visitor', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    for (const id of SIGNED_IN_MODULE_TESTIDS) {
      expect(html, `signed-in module ${id} must be removed from the static homepage`).not.toContain(
        `data-testid="${id}"`,
      )
    }
  })

  test('the curated content renders anonymously when the catalog is non-empty', async ({ request }) => {
    // Derive non-emptiness from the public catalog so the assertion is environment-aware
    // (mirrors static-shell-split.spec.ts). Empty env → nothing curated to assert.
    const cat = await request.get('/api/ucp/catalog?limit=1')
    expect(cat.ok()).toBeTruthy()
    const hasListings = !!(await cat.json())?.items?.length
    test.skip(!hasListings, 'no active listings in this environment')

    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    // Curated shell markers — the value-prop ribbon (always) + the Selección heading.
    expect(html).toContain('data-testid="home-ribbon"')
    expect(html).toContain('Selección de la semana')
  })
})
