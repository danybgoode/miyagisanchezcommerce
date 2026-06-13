import { test, expect, type Page } from '@playwright/test'

/**
 * PDP redesign (epic 01) — Sprint 1, real-browser, ANONYMOUS (no auth).
 * Covers the layout facts the `api` harness can't see: mobile reorder (S1.2),
 * the protection cue beside the price (S1.4), and the sticky-bar no-overlap fix
 * (S1.1) / one-primary-action (S1.3). All assertions are data-resilient — if a
 * listing lacks the relevant block we `test.skip` rather than fail on prod data.
 *
 * Assumes the `pdp_redesign` kill-switch is ENABLED (its default). When off, these
 * testids are absent and the tests skip.
 *
 * The authed pending-offer bar state is OWED TO DANIEL (needs a buyer session with a
 * live pending offer) — it is intentionally not covered here.
 */

// Open the first product-detail card on the listings page. Returns false when none.
async function openFirstListing(page: Page, search = ''): Promise<boolean> {
  await page.goto(`/l${search}`)
  const card = page.locator('a[href^="/l/"]').first()
  if ((await card.count()) === 0) return false
  const href = await card.getAttribute('href')
  if (!href) return false
  await page.goto(href)
  return true
}

test.describe('pdp redesign · mobile reorder + cues', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true })

  test('S1.2 — description renders above the payment methods box and seller card', async ({ page }) => {
    const opened = await openFirstListing(page)
    test.skip(!opened, 'no listings in prod right now')

    const desc = page.locator('[data-testid="pdp-description-mobile"]')
    test.skip((await desc.count()) === 0, 'listing has no description / redesign disabled')

    const methods = page.locator('[data-testid="pdp-methods"]')
    const seller = page.locator('[data-testid="seller-trust-card"]:visible').first()

    const descBox = await desc.boundingBox()
    expect(descBox).not.toBeNull()

    if ((await methods.count()) > 0) {
      const methodsBox = await methods.boundingBox()
      expect(descBox && methodsBox && descBox.y < methodsBox.y).toBeTruthy()
    }
    if ((await seller.count()) > 0) {
      const sellerBox = await seller.boundingBox()
      expect(descBox && sellerBox && descBox.y < sellerBox.y).toBeTruthy()
    }
  })

  test('S1.4 — the "Pago protegido" cue sits by the price, above the methods box', async ({ page }) => {
    const opened = await openFirstListing(page)
    test.skip(!opened, 'no listings in prod right now')

    const slim = page.locator('[data-testid="trust-signals-slim"]').first()
    test.skip((await slim.count()) === 0, 'no protection signal for this listing (unverified + no online rail)')

    await expect(slim).toContainText('Pago protegido')

    const methods = page.locator('[data-testid="pdp-methods"]')
    if ((await methods.count()) > 0) {
      const slimBox = await slim.boundingBox()
      const methodsBox = await methods.boundingBox()
      expect(slimBox && methodsBox && slimBox.y < methodsBox.y).toBeTruthy()
    }
  })

  test('S1.1/S1.3 — the sticky bar reserves its real height and shows one primary action', async ({ page }) => {
    const opened = await openFirstListing(page, '?listing_type=product')
    test.skip(!opened, 'no product listings in prod right now')

    const bar = page.locator('[data-testid="pdp-sticky-bar"]')
    test.skip((await bar.count()) === 0, 'this listing has no buy bar (unclaimed / no price / sold out)')

    // S1.1 — no overlap: the in-flow spacer matches the bar's real rendered height,
    // so content can never be clipped behind the fixed bar (the reported bug).
    const spacer = page.locator('[data-testid="pdp-bar-spacer"]')
    const barBox = await bar.boundingBox()
    const spacerBox = await spacer.boundingBox()
    expect(barBox && spacerBox && Math.abs(spacerBox.height - barBox.height) <= 2).toBeTruthy()

    // S1.3 — one clear primary action: at most a single dominant purchase CTA in the
    // bar (anonymous → "Inicia sesión para comprar"); "Preguntar" is a light link, not
    // a competing button.
    const primary = bar.locator('a:has-text("Comprar"), a:has-text("Inicia sesión para comprar")')
    expect(await primary.count()).toBeLessThanOrEqual(1)
  })
})
