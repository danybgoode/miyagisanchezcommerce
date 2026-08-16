import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`root selector chooses Mexico without an automatic redirect (${viewport.name})`, async ({ page }) => {
    /**
     * Three listeners, because "is this page healthy" is three different questions
     * and the old single `console` listener conflated them into one.
     *
     * This spec went red on 2026-08-01, 08-03 and 08-05 against an unchanged `main`,
     * and was written off three times as a flaky third-party resource. It was not
     * flaky — it was right. `/` was serving a SEVEN-DAY-OLD Cloudflare copy whose
     * build-hashed `/_next/static/chunks/*` no longer existed (see
     * `app/(site)/page.tsx`'s `revalidate` note). The CSS 404 made the homepage
     * render unstyled; the JS 404 threw ChunkLoadError, so the page never finished
     * loading — which is the 08-05 `page.goto` timeout that got filed as "transient
     * network unavailability". The variable was never the repo; it was the edge cache.
     */

    // 1. FIRST-PARTY ASSETS — a `/_next/*` 4xx/5xx is never noise. This is a direct
    //    assertion on the failure itself rather than an inference from Chromium's
    //    console prose, so it cannot be silenced by the message filter below. No
    //    third party serves `/_next/`, so the path alone establishes first-party.
    const brokenAssets: string[] = []
    page.on('response', (res) => {
      const { pathname } = new URL(res.url())
      if (pathname.startsWith('/_next/') && res.status() >= 400) {
        brokenAssets.push(`${res.status()} ${pathname}`)
      }
    })

    // 2. UNCAUGHT EXCEPTIONS — the listener this spec never had, so a throw (exactly
    //    the ChunkLoadError above) passed silently. Kept from the #344 draft, which
    //    got this part right.
    const jsErrors: string[] = []
    page.on('pageerror', (err) => jsErrors.push(`pageerror: ${err.message}`))

    // 3. CONSOLE ERRORS — minus Chromium's own resource-load-failure prose, which
    //    duplicates listener 1 for first-party assets and is genuine noise for
    //    third-party ones (remote/hotlinked images 4xx routinely, and that is a
    //    content problem, not a defect in this page's code). Safe to filter ONLY
    //    because listener 1 now asserts the first-party case precisely; filtering it
    //    with nothing underneath — as the original #344 draft proposed — would have
    //    blinded this spec to the very outage it was reporting.
    const RESOURCE_LOAD_FAILURE = /^Failed to load resource: the server responded with a status of \d+/
    page.on('console', (message) => {
      if (message.type() === 'error' && !RESOURCE_LOAD_FAILURE.test(message.text())) {
        jsErrors.push(message.text())
      }
    })

    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('market-selector')).toBeVisible()
    await expect(page.getByTestId('market-choice-mx')).toHaveAttribute('href', '/mx')
    await expect(page.getByTestId('market-choice-us')).toHaveAttribute('href', '/us')
    await expect(page.locator('[data-listing-id]')).toHaveCount(0)

    await page.getByTestId('market-choice-mx').click()
    await expect(page).toHaveURL(/\/mx$/)
    await expect(page.locator('body')).toContainText('Lo que tu barrio vende, compra y recomienda')

    // Asserted separately so the failure message names WHICH kind of broken this is:
    // a stale-CDN asset problem reads nothing like an application JS error, and the
    // three months this spec spent being dismissed as flaky is what conflating them
    // costs.
    expect(brokenAssets, 'first-party /_next asset(s) failed to load').toEqual([])
    expect(jsErrors).toEqual([])
  })
}

test('US is an English marketplace home, not the former recruiting surface', async ({ page }) => {
  const response = await page.goto('/us')

  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByTestId('us-invitation')).toHaveCount(0)
  await expect(page.locator('body')).toContainText('What your neighborhood sells, buys, and recommends')
  await expect(page.locator('body')).not.toContainText('Working hypothesis')
})

test('US marketplace children resolve while a cross-market fixture remains absent', async ({ page }) => {
  const browse = await page.goto('/us/l')
  expect(browse?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  const missing = await page.goto('/us/l/prod_market_boundary_fixture')
  expect(missing?.status()).toBe(404)
})
