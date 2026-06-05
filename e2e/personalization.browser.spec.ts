import { test, expect } from '@playwright/test'
import { requireEnv } from './_helpers/auth'

/**
 * Configurable & Personalized Products — real-browser smoke (AC 2.1 / 2.2 / 2.3).
 * Closes the gap the API harness can't reach: the personalization buy box is a
 * client island, so only a browser sees the fields render, the counter tick, and
 * the required-field nudge fire. Runs anonymously — the buy box shows the fields
 * (and intercepts an incomplete buy) before any sign-in.
 *
 * Fixture: MS_TEST_PERSONALIZED_LISTING_ID — a PUBLIC listing that has at least
 * one REQUIRED custom field. Skips cleanly when unset.
 */
const LISTING_ID = process.env.MS_TEST_PERSONALIZED_LISTING_ID

function buyCta(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: /comprar ahora|inicia sesión para comprar/i }).first()
}

test.describe('personalization · buy box (browser)', () => {
  test.beforeEach(() => {
    requireEnv(LISTING_ID, 'MS_TEST_PERSONALIZED_LISTING_ID')
  })

  test('custom fields render before the buy CTA, with a live counter (AC 2.1/2.2)', async ({ page }) => {
    await page.goto(`/l/${LISTING_ID}`)

    const field = page.locator('[id^="pf_"]').first()
    await expect(field).toBeVisible()

    // The field sits above the buy CTA (natural reading order, AC 2.1).
    const fieldBox = await field.boundingBox()
    const ctaBox = await buyCta(page).boundingBox()
    expect(fieldBox && ctaBox && fieldBox.y < ctaBox.y).toBeTruthy()

    // Counter reacts on keystroke (AC 2.2) — only meaningful on a text input.
    const tag = await field.evaluate(el => el.tagName.toLowerCase())
    if (tag === 'input' || tag === 'textarea') {
      await field.fill('ABC')
      await expect(page.locator('text=/\\b3\\/\\d+\\b/').first()).toBeVisible()
    }
  })

  test('a blank required field gracefully intercepts the buy (AC 2.3)', async ({ page }) => {
    await page.goto(`/l/${LISTING_ID}`)
    // Don't fill anything — click the CTA and expect the gentle nudge, not a nav.
    await buyCta(page).click()
    await expect(page.getByText('Completa este campo para continuar.').first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/l/${LISTING_ID}`)) // stayed put, no abrupt redirect
  })
})
