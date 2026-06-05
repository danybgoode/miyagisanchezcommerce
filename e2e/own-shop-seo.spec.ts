import { test, expect } from '@playwright/test'

/**
 * Own-shop experience — SEO continuity (epic 07 · own-shop-experience, sprint 2).
 *
 * US-4/US-5 move a shop's links + ranking to its live custom domain via 308
 * redirects and canonical/OG tags, and add host-aware robots.txt + sitemap.xml.
 *
 * The POSITIVE path (a shop WITH a verified custom domain → 308 to that domain,
 * canonical points there) can't run in CI: the only custom domain in the system
 * (panuchas.com) is unverified, and flipping that flag on a real shop would make
 * prod redirect a live shop to a dead host. So that path is Daniel's live smoke
 * once a real domain is verified. What's verified here:
 *  - robots.txt / sitemap.xml exist and are well-formed.
 *  - the NEGATIVE gate: a shop withOUT a verified domain is NOT redirected and
 *    self-canonicalises to the marketplace (guards against a redirect-everyone bug).
 *
 * Read-only — no mutations.
 */

test.describe('Own-shop — SEO continuity', () => {
  test('robots.txt is served and advertises a sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.ok()).toBeTruthy()
    const body = await res.text()
    expect(body).toContain('User-Agent: *')
    expect(body).toContain('Allow: /')
    expect(body).toContain('Sitemap:')
  })

  test('sitemap.xml lists marketplace entry points on the platform host', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.ok()).toBeTruthy()
    const body = await res.text()
    expect(body).toContain('<urlset')
    expect(body).toContain('https://miyagisanchez.com/')
  })

  test('a shop without a verified custom domain is NOT redirected and self-canonicalises', async ({ request }) => {
    // Derive a real shop slug from the public catalog (no verified custom domain
    // exists in any environment today, so this shop self-canonicalises). Skip if
    // the environment has no active listings rather than fail on a hardcoded slug.
    const cat = await request.get('/api/ucp/catalog?limit=1')
    expect(cat.ok()).toBeTruthy()
    const slug = (await cat.json())?.items?.[0]?.shop?.slug
    test.skip(!slug, 'no active listings in this environment')

    const res = await request.get(`/s/${slug}`, { maxRedirects: 0 })
    // No legacy→domain redirect when the shop has no live custom domain.
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('rel="canonical"')
    expect(html).toContain(`miyagisanchez.com/s/${slug}`)
  })
})
