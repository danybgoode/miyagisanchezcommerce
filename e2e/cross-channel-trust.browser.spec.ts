import { test, expect } from '@playwright/test'

/**
 * Cross-channel Storefront Trust Parity (#3c · Epic D) — Sprint 1.
 * Real-browser, ANONYMOUS (no auth) — runs on the preview/prod.
 *
 * Asserts Epic C's `<TrustSignals>` reaches the off-marketplace surfaces:
 *  - D.1: the embed shop grid renders the payment/returns/pickup method block.
 *  - D.2: the white-label shell renders the discreet "Pago seguro · Compra
 *         protegida" platform-assurance strip.
 *
 * ⚠️ Why the embed surface stands in for the white-label shell: middleware STRIPS
 * spoofed `x-miyagi-*` trust headers on platform hosts (only middleware may set
 * them), so a browser test cannot simulate `x-miyagi-channel=custom`/`subdomain`
 * against the preview. But `/embed/*` is tagged white-label by PATH
 * (`x-miyagi-embed=1`), so it is a real, un-spoofable render through the SAME
 * `ChannelLayout` the custom-domain/subdomain shell uses — the strip is exercised
 * there. The live custom-domain + subdomain cosmetic look is owed to Daniel.
 *
 * Data-resilient: derives a real shop slug from the public catalog; skips (not
 * fails) when the environment has no active listings.
 */
test.describe('Cross-channel trust parity (Epic D)', () => {
  test('embed grid + white-label shell render trust signals', async ({ page, request }) => {
    const cat = await request.get('/api/ucp/catalog?limit=1')
    expect(cat.ok()).toBeTruthy()
    const slug = (await cat.json())?.items?.[0]?.shop?.slug as string | undefined
    test.skip(!slug, 'no active listings in this environment')

    await page.goto(`/embed/s/${slug}`)

    // D.2 — the platform-assurance strip renders in the white-label shell
    // (ChannelLayout). Reliable: the lead line is static and always rendered
    // whenever the shell receives the trust slot (the embed page always passes it).
    await expect(page.getByText('Pago seguro · Compra protegida')).toBeVisible()

    // D.1 — the payment/returns/pickup method block renders on the embed grid.
    // Reliable: Mercado Pago is the platform default-on rail, so the payment grid
    // (and thus the method box) renders for any normally-configured shop.
    await expect(page.getByTestId('pdp-methods')).toBeVisible()
  })
})
