import { test, expect } from '@playwright/test'

/**
 * Site-wide GTM container loader — opt-in browser smoke (closes the coverage gap the
 * cross-agent review flagged on S1.3: the api spec only sees the SSR marker, not that
 * `injectGtm()` actually runs and respects the gate).
 *
 * GTM injection is JS-only and gated on `NEXT_PUBLIC_GTM_ID` being baked into the
 * target build, so this can only assert real injection against a deploy that HAS the
 * id configured. Set `MS_TEST_GTM_ID=1` when pointing Playwright at such a target
 * (a preview/prod with `NEXT_PUBLIC_GTM_ID` set); the spec skips cleanly otherwise, so
 * the blocking `api` gate is unaffected (this is a `*.browser.spec.ts`, not in the gate).
 *
 * Run: `MS_TEST_GTM_ID=1 PLAYWRIGHT_BASE_URL=<target> npm run test:e2e:browser`
 */
const GTM_CONFIGURED = !!process.env.MS_TEST_GTM_ID

const gtmState = () => ({
  hasScript: !!document.querySelector('script[src*="googletagmanager.com/gtm.js"]'),
  hasDataLayer: Array.isArray((window as unknown as { dataLayer?: unknown[] }).dataLayer),
})

test.describe('site-analytics loader · GTM injection (browser)', () => {
  test.skip(
    !GTM_CONFIGURED,
    'set MS_TEST_GTM_ID=1 against a target whose NEXT_PUBLIC_GTM_ID is configured',
  )

  test('injects the GTM container on the public marketplace root', async ({ page }) => {
    await page.goto('/')
    // The loader runs in a useEffect after hydration — wait for the script to land.
    await expect
      .poll(async () => (await page.evaluate(gtmState)).hasScript, { timeout: 10_000 })
      .toBe(true)
    expect((await page.evaluate(gtmState)).hasDataLayer).toBe(true)
  })

  test('does NOT inject GTM on the embed widget (white-label by path)', async ({ page }) => {
    await page.goto('/embed/s/miyagi')
    // Give the effect the same window it would have had to fire, then assert it didn't.
    await page.waitForTimeout(2_000)
    expect((await page.evaluate(gtmState)).hasScript).toBe(false)
  })
})
