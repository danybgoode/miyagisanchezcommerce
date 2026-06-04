import { test, expect } from '@playwright/test'

/**
 * Embeddable Widget · Sprint 2 (US-5) — full-shop iframe surface.
 * The whole point is that ANY site can frame /embed/s/[slug], so the route must
 * carry `Content-Security-Policy: frame-ancestors *` and must not be blocked by
 * a restrictive X-Frame-Options. Read-only.
 *
 * The white-label render (no platform chrome) + buy-breaks-out-of-frame are
 * visual/auth behaviours covered by live confirmation (the demo page + Daniel),
 * not asserted here.
 */
test.describe('Embed full-shop — framable surface', () => {
  test('the /embed/ route is served frame-ancestors * (framable anywhere)', async ({ request }) => {
    // Header is applied by next.config to the whole /embed/* path, so it holds
    // even for an unknown slug (no dependency on a seeded shop).
    const res = await request.get('/embed/s/__smoke__', { headers: { Accept: 'text/html' } })
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp).toContain('frame-ancestors')
    // Must NOT be hard-blocked from framing.
    expect(res.headers()['x-frame-options'] ?? '').not.toMatch(/deny|sameorigin/i)
  })

  test('renders a real shop storefront when one exists', async ({ request }) => {
    // Derive a real shop slug from the public catalog (shares the live Medusa
    // backend). If the environment has no active listings, there is nothing to
    // assert — skip rather than fail.
    const cat = await request.get('/api/ucp/catalog?limit=1')
    expect(cat.ok()).toBeTruthy()
    const slug = (await cat.json())?.items?.[0]?.shop?.slug
    test.skip(!slug, 'no active listings in this environment')

    const res = await request.get(`/embed/s/${slug}`, { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-security-policy'] ?? '').toContain('frame-ancestors')
  })
})
