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
 *
 * The slug MUST belong to a shop the D.1 assertion below can actually pass for
 * (i.e. one with a payment method configured) — `items[0]` picks whatever is
 * most recent, which can be a seller with no rail connected yet and would false-
 * fail D.1 on pure fixture drift, independent of whether trust parity holds.
 * `actions.buy_now` (`lib/ucp/schema.ts`) is the same public "has price + a
 * payment method" fact the PDP buy button gates on, so filtering on it picks a
 * shop the payment grid is guaranteed to render for.
 */
test.describe('Cross-channel trust parity (Epic D)', () => {
  test('embed grid + white-label shell render trust signals', async ({ page, request }) => {
    const cat = await request.get('/api/ucp/catalog?limit=20')
    expect(cat.ok()).toBeTruthy()
    const items = (await cat.json())?.items as Array<{ actions?: { buy_now?: boolean }; shop?: { slug?: string } }> | undefined
    const slug = items?.find((item) => item.actions?.buy_now)?.shop?.slug
    test.skip(!slug, 'no active listing with a configured payment method in this environment')

    await page.goto(`/embed/s/${slug}`)

    // D.2 — the platform-assurance strip renders in the white-label shell
    // (ChannelLayout). Reliable: the lead line is static and always rendered
    // whenever the shell receives the trust slot (the embed page always passes it).
    await expect(page.getByText('Pago seguro · Compra protegida')).toBeVisible()

    // D.1 — the payment/returns/pickup method block renders on the embed grid.
    // Reliable: the `buy_now` filter above only accepts a shop with Stripe or
    // Mercado Pago connected, so the payment grid (and thus the method box)
    // is guaranteed at least one entry.
    await expect(page.getByTestId('pdp-methods')).toBeVisible()
  })
})
