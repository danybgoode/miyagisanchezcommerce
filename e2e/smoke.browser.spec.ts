import { test, expect } from '@playwright/test'
import { buyerCreds, authEnabled, requireEnv, signIn } from './_helpers/auth'

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
  // Template for money-path smokes. OFF by default: the production Clerk instance
  // is email-code/OAuth-first, so a headless password sign-in hits a second-factor
  // (email-code) step. Enabling real authed smokes needs the Clerk testing-token
  // setup (@clerk/testing) + the prod Clerk keys — a security decision. Opt in with
  // MS_TEST_BROWSER_AUTH=1 once that's wired. See e2e/README.md.
  test('a buyer can sign in and reach their account', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ Clerk testing setup) to run authed browser smokes.')
    const creds = requireEnv(buyerCreds(), 'MS_TEST_BUYER_EMAIL / MS_TEST_BUYER_PASSWORD')
    await signIn(page, creds)
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
