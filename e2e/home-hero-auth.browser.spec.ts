import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * home-dynamic-rows-restore-and-polish — Sprint 3, Story 3.1. The hero + trust badges
 * ("home-hero") supersede the old value-prop ribbon entirely and are wrapped in
 * `<AuthShow when="signed-out">` — its job is done once a buyer is back, so the
 * personalized rail should sit at the top instead.
 *
 *  • ANONYMOUS — always runs. The hero prerenders into static HTML for a signed-out
 *    visitor (mirrors `home-static.spec.ts`'s API-level check, but post-hydration in a
 *    real browser — `AuthShow` must not remove it when there's no session).
 *  • SIGNED-IN — fixture-gated (MS_TEST_BROWSER_AUTH=1 + MS_TEST_BUYER_EMAIL, dev/preview
 *    only). Once hydration confirms a real session, the hero must be gone.
 */

test.describe('home-hero · signed-out only (browser)', () => {
  test('anonymous: the hero is present and visible', async ({ page }) => {
    await page.goto('/mx')
    // No `waitForLoadState('networkidle')` here: both assertions below auto-wait,
    // so it bought nothing and cost a recurring nightly failure. The marketplace
    // homepage carries analytics/beacon traffic that can keep the network busy
    // past any budget, so `networkidle` is not reachable on a bad day and the
    // 30s test timeout fires inside the wait, before a single assertion runs.
    // This was the only file pair in the suite using it — and the only one flaking.
    const hero = page.locator('[data-testid="home-hero"]')
    await expect(hero).toHaveCount(1)
    await expect(hero).toBeVisible()
  })

  test('signed-in: the hero is gone once hydration confirms the session', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')
    await signIn(page, email)
    await page.goto('/mx')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-testid="home-hero"]')).toHaveCount(0)
  })
})
