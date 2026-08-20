import { expect, test } from '@playwright/test'

/**
 * Real-browser proof that the press and pending states DO something.
 *
 * These properties are unobservable to the API harness by construction —
 * `:active` only exists while a real pointer is held down, and `data-pending`
 * only exists during a real client-side navigation. A unit test asserting "the
 * CSS file contains `.card-tile:active`" would prove the string is present, not
 * that anything visibly changes, which is the failure mode the whole feature is
 * about: an affordance that is declared but not felt.
 */

test.describe('press feedback', () => {
  test('holding a catalog tile down changes it BEYOND its hover state, and releasing restores it', async ({ page }) => {
    await page.goto('/mx')

    const tile = page.locator('a.card-tile').first()
    await expect(tile).toBeVisible()

    const transformOf = () => tile.evaluate((el) => getComputedStyle(el).transform)

    const box = await tile.boundingBox()
    if (!box) throw new Error('catalog tile has no box — the page did not render a tile to press')
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

    // The baseline is the HOVERED transform, not the resting one. A tile already
    // lifts on hover, so comparing against rest passes the moment the pointer
    // arrives — this spec did exactly that at first and stayed green through a
    // mutation that deleted the entire `.card-tile:active` rule. The press has to
    // be shown to differ from hover, or it is not being tested at all.
    await page.mouse.move(centre.x, centre.y)
    // Let the hover transition SETTLE before sampling. A mid-transition sample
    // is a moving target, and the restore assertion at the end then compares
    // against a value the element was only passing through.
    await page.waitForTimeout(500)
    const hovered = await transformOf()
    expect(hovered).not.toBe('none')

    await page.mouse.down()
    await page.waitForTimeout(250) // the press transition is ~90ms
    const pressed = await transformOf()
    expect(pressed).not.toBe(hovered)

    // Release with the pointer OFF the tile, so no click fires and no navigation
    // replaces the element we are still measuring.
    await page.mouse.move(1, 1)
    await page.mouse.up()
    await page.mouse.move(centre.x, centre.y)
    await expect.poll(transformOf, { timeout: 1500 }).toBe(hovered)
  })
})

test.describe('pending feedback', () => {
  test('a slow navigation marks the clicked link and shows the progress bar', async ({ page }) => {
    // Make the navigation observably slow. Without this the assertion is a race:
    // a prefetched route can resolve in under 100ms, and a spec that passes only
    // when the network happens to be slow is a spec that will flake into
    // uselessness and then be deleted.
    //
    // Two things about this setup are load-bearing, and the first version had
    // neither. It registered the handler AFTER `goto('/mx')` and merely DELAYED
    // prefetch requests, so against production it measured nothing: the grid's
    // links are prefetched while the page settles, the destination lands in the
    // router cache, and a cache hit issues NO NETWORK REQUEST AT ALL. Delaying a
    // request that never happens does not slow anything down. The click resolved
    // in ~150ms, RouteProgress correctly declined to paint for a navigation that
    // fast (NAV_PROGRESS_DELAY_MS is 140ms and exists precisely for this), and the
    // spec failed while the feature worked. It survived review and the nightly
    // because both hit a cold edge where the prefetch was still in flight —
    // green for the wrong reason, which is the same failure as being red.
    //
    // So: registered BEFORE the first navigation, and the prefetch is REFUSED
    // rather than delayed, which is what forces the click onto the network where
    // the delay can reach it. Verified against production: the bar runs
    // 16% -> 74% across the delay and clears on arrival.
    await page.route('**/*', async (route) => {
      const request = route.request()
      const headers = request.headers()
      if (headers['next-router-prefetch'] !== undefined) return route.abort()
      const isNavigationFetch =
        request.resourceType() === 'document' || headers['rsc'] !== undefined
      if (isNavigationFetch) await new Promise((r) => setTimeout(r, 1200))
      await route.continue()
    })

    await page.goto('/mx')

    const tile = page.locator('a.card-tile[href*="/l/"]').first()
    await expect(tile).toBeVisible()
    await tile.click({ noWaitAfter: true })

    // The link the user actually clicked is the one marked — that is the whole
    // point of the per-link signal over a single global spinner.
    await expect(tile).toHaveAttribute('data-pending', 'true', { timeout: 4000 })
    await expect(page.getByTestId('route-progress')).toBeVisible({ timeout: 4000 })
  })

  test('the pending flag is CLEARED after arrival — no permanently dimmed link', async ({ page }) => {
    // A flag left behind is a "still loading" claim about a finished navigation,
    // and it takes the link's cursor with it. This asserts the cleanup, which is
    // the half most likely to be dropped in a refactor.
    await page.goto('/mx')
    const tile = page.locator('a.card-tile[href*="/l/"]').first()
    await expect(tile).toBeVisible()
    await tile.click()

    await page.waitForURL(/\/l\//, { timeout: 15000 })
    await expect(page.locator('[data-pending="true"]')).toHaveCount(0)
    await expect(page.getByTestId('route-progress')).toHaveCount(0)
  })
})
