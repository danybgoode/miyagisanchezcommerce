import { test, expect } from '@playwright/test'
import { requireEnv } from './_helpers/auth'

/**
 * Trust & Messaging Polish (#3c · Epic C) — Sprint 2, C.4.
 *
 * No-regression smoke for the parity-first extraction of the PDP trust block into the
 * shared `<TrustSignals>` component. Runs anonymously (the trust signals render for any
 * visitor, no sign-in). Asserts the extracted methods box + headings still render on a
 * real PDP — proving the refactor didn't drop the signals.
 *
 * Fixture: MS_TEST_PDP_LISTING_ID (preferred) or MS_TEST_PERSONALIZED_LISTING_ID — any
 * PUBLIC listing whose seller exposes at least one payment OR fulfillment method. Skips
 * cleanly when neither is set.
 */
const LISTING_ID = process.env.MS_TEST_PDP_LISTING_ID || process.env.MS_TEST_PERSONALIZED_LISTING_ID

test.describe('trust-signals · PDP parity (browser)', () => {
  test.beforeEach(() => {
    requireEnv(LISTING_ID, 'MS_TEST_PDP_LISTING_ID')
  })

  test('the extracted methods box still renders on the marketplace PDP (no regression)', async ({ page }) => {
    await page.goto(`/l/${LISTING_ID}`)

    // The PDP rendered (not a 404 / crash).
    await expect(page.locator('h1').first()).toBeVisible()

    // The extracted <TrustSignals variant="full"> box is present...
    const box = page.locator('[data-testid="pdp-methods"]')
    await expect(box).toBeVisible()

    // ...and carries at least one of the two trust headings the component renders.
    await expect(
      box.getByText(/Métodos disponibles|Entrega y disponibilidad/).first(),
    ).toBeVisible()
  })
})
