import { test, expect, type Page } from '@playwright/test'

/**
 * Discovery Polish · Sprint 3 — PDP hierarchy, real-browser, ANONYMOUS (no auth).
 * Closes the gap the API harness can't see: the type frame is rendered markup and
 * the mobile trust-above-methods order is a CSS-driven layout fact.
 *
 * Data-resilient: every assertion holds against whatever prod actually contains —
 * if a filter yields no listings we skip rather than fail on empty data.
 */

// Open the first listing card on a (optionally type-filtered) search page.
// Returns false when no listing card is present (caller skips).
async function openFirstListing(page: Page, search = ''): Promise<boolean> {
  await page.goto(`/l${search}`)
  // Card links are `/l/<id>`; breadcrumb/category/type-chip links are `/l?…`,
  // so the `/l/` prefix selects only product-detail links.
  const card = page.locator('a[href^="/l/"]').first()
  if ((await card.count()) === 0) return false
  const href = await card.getAttribute('href')
  if (!href) return false
  await page.goto(href)
  return true
}

test.describe('pdp · type-specific decision frame (S3.1)', () => {
  test('a service PDP leads with the service type frame', async ({ page }) => {
    const opened = await openFirstListing(page, '?listing_type=service')
    test.skip(!opened, 'no service listings in prod right now')

    const frame = page.locator('[data-testid="pdp-type-frame"]')
    await expect(frame).toBeVisible()
    await expect(frame).toContainText('Servicio')
    await expect(frame).toContainText('Solicita o agenda')
  })

  test('a product PDP has no type frame — the buy box leads instead', async ({ page }) => {
    const opened = await openFirstListing(page, '?listing_type=product')
    test.skip(!opened, 'no product listings in prod right now')

    // product → listingTypeFrame() is null, so the banner never renders.
    await expect(page.locator('[data-testid="pdp-type-frame"]')).toHaveCount(0)
  })
})

test.describe('pdp · seller trust above the fold on mobile (S3.2)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true })

  test('the seller trust card renders above the payment/fulfillment methods box', async ({ page }) => {
    const opened = await openFirstListing(page)
    test.skip(!opened, 'no listings in prod right now')

    const trust = page.locator('[data-testid="seller-trust-card"]:visible').first()
    const methods = page.locator('[data-testid="pdp-methods"]')
    // Only meaningful when this listing has both blocks (claimed shop + methods).
    test.skip((await trust.count()) === 0 || (await methods.count()) === 0, 'listing lacks a trust card or methods box')

    const trustBox = await trust.boundingBox()
    const methodsBox = await methods.boundingBox()
    expect(trustBox && methodsBox && trustBox.y < methodsBox.y).toBeTruthy()
  })
})
