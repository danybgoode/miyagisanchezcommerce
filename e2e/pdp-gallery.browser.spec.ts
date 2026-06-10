import { test, expect, type Page } from '@playwright/test'
import { requireEnv } from './_helpers/auth'

/**
 * PDP interactive image gallery — real-browser smoke, ANONYMOUS (no auth).
 * Closes the gap the API harness can't reach: the gallery is a client island, so
 * only a browser sees the main image swap on a thumbnail/arrow/keyboard step and
 * the fullscreen lightbox open/close.
 *
 * Fixture: MS_TEST_GALLERY_LISTING_ID — a PUBLIC listing with 2+ photos. Skips
 * cleanly when unset (mirrors MS_TEST_PERSONALIZED_LISTING_ID). Also self-skips
 * if the listing happens to carry <2 photos, so it never false-fails on data.
 *
 * The island reads no channel header (pure images/title/overlay props), so this
 * marketplace-PDP smoke exercises the same component every channel renders; the
 * live custom-domain/subdomain white-label look stays owed to Daniel.
 */
const LISTING_ID = process.env.MS_TEST_GALLERY_LISTING_ID

const mainImg = (page: Page) => page.getByTestId('gallery-main-desktop')
const thumbs = (page: Page) => page.getByTestId('gallery-thumb')

test.describe('pdp · interactive gallery (browser)', () => {
  test.beforeEach(async ({ page }) => {
    requireEnv(LISTING_ID, 'MS_TEST_GALLERY_LISTING_ID')
    await page.goto(`/l/${LISTING_ID}`)
    await expect(page.getByTestId('pdp-gallery')).toBeVisible()
    const n = await thumbs(page).count()
    test.skip(n < 2, 'listing has <2 photos — nothing to step through')
  })

  test('thumbnail, arrow and ←/→ swap the main image (S1.1)', async ({ page }) => {
    const first = await mainImg(page).getAttribute('src')

    // Thumbnail click → main swaps + that thumb is marked current.
    await thumbs(page).nth(1).click()
    await expect(mainImg(page)).not.toHaveAttribute('src', first ?? '')
    await expect(thumbs(page).nth(1)).toHaveAttribute('aria-current', 'true')

    // Next arrow → swaps again.
    const afterThumb = await mainImg(page).getAttribute('src')
    await page.getByRole('button', { name: 'Imagen siguiente' }).first().click()
    await expect(mainImg(page)).not.toHaveAttribute('src', afterThumb ?? '')

    // ←/→ keyboard on the focused gallery → steps it.
    const afterArrow = await mainImg(page).getAttribute('src')
    await page.getByTestId('pdp-gallery').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(mainImg(page)).not.toHaveAttribute('src', afterArrow ?? '')
  })

  test('tap main image opens the lightbox; Esc closes it (S1.2)', async ({ page }) => {
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0) // not mounted until opened

    await mainImg(page).click()
    const lb = page.getByTestId('gallery-lightbox')
    await expect(lb).toBeVisible()
    await expect(lb).toHaveAttribute('role', 'dialog')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0)
  })
})
