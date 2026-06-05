import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Browser harness — baseline smoke (the `browser` project · Chromium).
 * Proves the real-browser layer works end-to-end and demonstrates the
 * credential-gated pattern that authed smokes follow.
 *
 * Run:  npx playwright install chromium && npm run test:e2e:browser
 */
test.describe('browser smoke · app shell', () => {
  test('the marketplace renders in a real browser', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBeTruthy()
    await expect(page).toHaveTitle(/.+/)
    // The app shell mounted (not a blank/error doc).
    await expect(page.locator('body')).not.toBeEmpty()
  })
})

test.describe('browser smoke · authed (buyer)', () => {
  // Money-path template via @clerk/testing ticket sign-in. Runs against a dev/preview
  // (Clerk's testing token is dev-only); enable with MS_TEST_BROWSER_AUTH=1 + the dev
  // Clerk keys + MS_TEST_BUYER_EMAIL. See e2e/README.md.
  test('a buyer can sign in and reach their account', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')
    await signIn(page, email)
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
