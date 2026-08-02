import { test, expect } from '@playwright/test'
import { requireEnv } from './_helpers/auth'

/**
 * Unclaimed PDP is contact-only — real-browser smoke, ANONYMOUS (no auth).
 *
 * On a "Sin reclamar" (gem-imported) listing the buyer CTA tree must NOT render
 * (Comprar ahora / Hacer oferta / Arma un paquete); instead the SellerTrustCard
 * surfaces the claim nudge ("Reclamar"). This closes the gap the API harness can't
 * see (the CTAs are gated server-side in the page render). No login needed.
 *
 * Fixture: MS_TEST_UNCLAIMED_LISTING_ID — a PUBLIC listing on an unclaimed shop.
 * Self-skips if the listing isn't actually unclaimed (no claim nudge), so it never
 * false-fails on data drift (mirrors pdp-gallery's "<2 photos → skip").
 */
const LISTING_ID = process.env.MS_TEST_UNCLAIMED_LISTING_ID

test.describe('pdp · unclaimed is contact-only (browser)', () => {
  test('no Buy / Offer / Bundle CTAs render; the claim nudge does', async ({ page }) => {
    requireEnv(LISTING_ID, 'MS_TEST_UNCLAIMED_LISTING_ID')
    await page.goto(`/l/${LISTING_ID}`)
    // The PDP dual-renders SellerTrustCard (mobile `md:hidden` interstitial +
    // desktop `hidden md:block`, see app/l/[id]/page.tsx). `.first()` on the bare
    // testid picks DOM order, which is the mobile instance — always CSS-hidden on
    // this project's desktop-viewport browser. Scope to the visible one instead,
    // matching pdp-hierarchy.browser.spec.ts / pdp-redesign.browser.spec.ts.
    const sellerTrustCard = page.locator('[data-testid="seller-trust-card"]:visible').first()
    await expect(sellerTrustCard).toBeVisible()

    // Confirm the fixture really is unclaimed — the claim nudge is the tell. If a
    // claimed listing was set by mistake, skip rather than false-fail.
    //
    // Scoped to the VISIBLE card for the same dual-render reason as above: the nudge
    // lives inside SellerTrustCard (`app/components/SellerTrustCard.tsx` — "¿Es tuya
    // esta tienda? Reclamar gratis"), so a page-wide match also picks up the hidden
    // mobile twin, and `/s/[slug]`'s own ClaimButton ("¿Es tu tienda? Reclamar") if a
    // future layout change ever puts one on this route.
    const claimNudge = sellerTrustCard.getByRole('link', { name: /Reclamar/i })
    const isUnclaimed = (await claimNudge.count()) > 0
    test.skip(!isUnclaimed, 'fixture listing is claimed (no "Reclamar" nudge) — set an unclaimed one')
    await expect(claimNudge.first()).toBeVisible()

    // None of the buyer money-path CTAs may render for an unclaimed shop.
    await expect(page.getByText('Comprar ahora', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Hacer oferta' })).toHaveCount(0)
    await expect(page.getByText('Inicia sesión para hacer oferta', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Arma un paquete' })).toHaveCount(0)
  })
})
