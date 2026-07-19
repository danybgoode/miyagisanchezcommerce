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

  test('exactly one main surface shows per viewport — no stacked duplicate (S1.1 regression)', async ({ page }) => {
    // Desktop Chrome: the single active image shows; the mobile swipe-track is hidden.
    // Guards the inline-`display`-beats-`md:hidden` bug that rendered both, stacked.
    await expect(mainImg(page)).toBeVisible()
    const track = page.getByTestId('gallery-track-mobile')
    await expect(track).toBeAttached() // present in the DOM (so toBeHidden can't pass vacuously)…
    await expect(track).toBeHidden()   // …but display:none on desktop, not stacked over the active image
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

  test('counter shows "1 / N" and advances with the active image; back + share present (S2.3)', async ({ page }) => {
    const counter = page.getByTestId('gallery-counter')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveText(/^1 \/ \d+$/) // starts at the first photo

    // Next arrow advances the active image → the counter tracks it.
    await page.getByRole('button', { name: 'Imagen siguiente' }).first().click()
    await expect(counter).toHaveText(/^2 \/ \d+$/)

    // Back + share controls are present (share fires native sheet or copy fallback).
    await expect(page.getByTestId('gallery-back')).toBeVisible()
    await expect(page.getByTestId('gallery-share')).toBeVisible()
  })

  test('tap main image opens the lightbox; its close X is hit-testable (S1.2)', async ({ page }) => {
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0) // not mounted until opened

    await mainImg(page).click()
    const lb = page.getByTestId('gallery-lightbox')
    await expect(lb).toBeVisible()
    await expect(lb).toHaveAttribute('role', 'dialog')

    // A visibility assertion alone is insufficient: the sticky platform header can
    // paint over the X while the button remains technically visible. A real click
    // fails if that header intercepts the pointer, which is the reported regression.
    await lb.getByRole('button', { name: 'Cerrar' }).click()
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0)
  })
})

/**
 * Single-image gallery parity (pdp-single-image-gallery-parity fix) — the
 * count===1 early return used to render a bare, inert `<img>` predating the
 * S2.3 lightbox/back/share redesign. Fixed by folding count===1 into the same
 * interactive render path (which already degrades correctly: no arrows/dots/
 * thumbs for a 1-length array), so this asserts it gets the lightbox + back/
 * share for free while the multi-image-only chrome stays absent.
 *
 * Fixture: MS_TEST_GALLERY_SINGLE_LISTING_ID — a PUBLIC listing with exactly 1
 * photo. Skips cleanly when unset; self-skips if the listing actually has 2+
 * (wrong fixture configured), mirroring the <2 self-skip above.
 */
const SINGLE_LISTING_ID = process.env.MS_TEST_GALLERY_SINGLE_LISTING_ID

test.describe('pdp · single-image gallery parity (browser)', () => {
  test.beforeEach(async ({ page }) => {
    requireEnv(SINGLE_LISTING_ID, 'MS_TEST_GALLERY_SINGLE_LISTING_ID')
    await page.goto(`/l/${SINGLE_LISTING_ID}`)
    await expect(page.getByTestId('pdp-gallery')).toBeVisible()
    const n = await thumbs(page).count()
    test.skip(n > 0, 'listing has 2+ photos — wrong fixture for the single-image case')
  })

  test('no multi-image chrome renders for a single photo', async ({ page }) => {
    await expect(page.getByTestId('gallery-thumb')).toHaveCount(0)
    await expect(page.getByTestId('gallery-counter')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Imagen siguiente' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Imagen anterior' })).toHaveCount(0)
  })

  test('back + share render; tap opens the lightbox with no arrows/counter', async ({ page }) => {
    await expect(page.getByTestId('gallery-back')).toBeVisible()
    await expect(page.getByTestId('gallery-share')).toBeVisible()

    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0)
    await mainImg(page).click()
    const lb = page.getByTestId('gallery-lightbox')
    await expect(lb).toBeVisible()
    await expect(lb).toHaveAttribute('role', 'dialog')

    // The lightbox's own count>1 gate hides arrows/counter for a single image.
    await expect(lb.getByRole('button', { name: 'Imagen siguiente' })).toHaveCount(0)
    await expect(lb.getByRole('button', { name: 'Imagen anterior' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0)
  })
})

/**
 * Zero-image placeholder parity (pdp-single-image-gallery-parity fix) — the
 * count===0 placeholder branch had the same back/share gap as the 1-image
 * branch (there's still a PDP to leave/share even with no photo).
 *
 * Fixture: MS_TEST_GALLERY_ZERO_LISTING_ID — a PUBLIC listing with no photos.
 * Skips cleanly when unset.
 */
const ZERO_LISTING_ID = process.env.MS_TEST_GALLERY_ZERO_LISTING_ID

test.describe('pdp · zero-image placeholder parity (browser)', () => {
  test('back + share render over the placeholder', async ({ page }) => {
    requireEnv(ZERO_LISTING_ID, 'MS_TEST_GALLERY_ZERO_LISTING_ID')
    await page.goto(`/l/${ZERO_LISTING_ID}`)
    await expect(page.getByTestId('pdp-gallery')).toBeVisible()

    await expect(page.getByTestId('gallery-back')).toBeVisible()
    await expect(page.getByTestId('gallery-share')).toBeVisible()
  })
})
