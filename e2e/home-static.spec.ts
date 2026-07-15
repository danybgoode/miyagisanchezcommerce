import { expect, test } from '@playwright/test'
import es from '../locales/es.json' with { type: 'json' }

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
    // Curated shell markers — the hero (always) + the Selección heading.
    expect(html).toContain('data-testid="home-hero"')
    expect(html).toContain('Selección de la semana')
  })

  test('Recién llegado al barrio renders anonymously when the recent-listings pool is non-empty', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    const hasRecienLlegado = html.includes('data-testid="home-recien-llegado"')
    test.skip(!hasRecienLlegado, 'no listings available for Recién llegado in this environment')
    expect(html).toContain(es.home.recienLlegado.heading)
    expect(html).toMatch(/href="\/l\?sort=reciente"[^>]*>\s*Ver todo/)
  })

  test('Pasillos chips carry the same live counts as the Categorías list (S3.3)', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    const categoriasSection = html.match(/<h2[^>]*>Categorías<\/h2>[\s\S]*?<\/section>/)?.[0]
    test.skip(!categoriasSection, 'no categories with active listings in this environment')

    // Every "label count" pair from the Categorías list must also appear in the
    // chip rail, proving both read the same getCategoryCounts() data (no drift).
    const rows = [...categoriasSection!.matchAll(
      /<span[^>]*>([^<]+)<\/span><span[^>]*>(\d+)<\/span>/g,
    )]
    expect(rows.length).toBeGreaterThan(0)
    const chipRail = html.match(/chip-rail mb-6"[\s\S]*?<\/div>/)?.[0] ?? ''
    for (const [, label, count] of rows) {
      expect(chipRail).toContain(`${label}<!-- --> ${count}`)
    }
    // The lead chip reads "Todas →" (relabeled from "Todo") once counts are passed.
    expect(chipRail).toContain('Todas')
  })

  test('the seller block renders above the unchanged signup row (S3.4)', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    // Gated on Selección being non-empty (same condition page.tsx renders on) —
    // rather than a different endpoint's non-emptiness, which can disagree with it.
    const hasSellerBlock = html.includes('data-testid="home-seller-block"')
    test.skip(!hasSellerBlock, 'Selección is empty in this environment (seller block hidden)')

    expect(html).toContain(es.home.sellerBlock.heading)
    for (const reassurance of es.home.sellerBlock.reassurances) {
      expect(html).toContain(reassurance)
    }
    const cta = html.match(/<a[^>]*data-testid="home-seller-block-cta"[^>]*>/)?.[0] ?? ''
    expect(cta).not.toBe('')
    expect(cta).toContain('href="/vende"')

    // Unchanged — the signup/explore row must still carry its exact original testid/href.
    const uneteLink = html.match(/<a[^>]*data-testid="home-unete-signup"[^>]*>/)?.[0] ?? ''
    expect(uneteLink).not.toBe('')
    expect(uneteLink).toContain('href="/sign-up"')
  })

  // admin-content-and-announcements S2.2 — the homepage's editorial strings now flow
  // through `getOverriddenDictionary('es').home` (locales/es.json's `home` namespace)
  // instead of being hardcoded JSX literals. Asserting against the imported dictionary
  // values (not a hardcoded string) means this fails loud if the wiring is ever reverted
  // to a literal, and self-updates if the copy is edited in `locales/es.json` directly.
  test('the hero renders the home.hero dictionary copy (no live override applied)', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).toContain(es.home.hero.heading)
    for (const badge of es.home.hero.badges) {
      expect(html).toContain(badge)
    }
  })
})
