import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`root selector chooses Mexico without an automatic redirect (${viewport.name})`, async ({ page }) => {
    // Real JS bugs land in two different Playwright events: `console` (type 'error',
    // e.g. a caught error the app logs, or React logging a warning-turned-error) and
    // `pageerror` (an uncaught exception) — the previous version of this test only
    // listened for the former, so an uncaught throw here would have passed silently.
    //
    // `console` also carries Chromium's own resource-load-failure noise — "Failed to
    // load resource: the server responded with a status of 400 ()" for any image/font/
    // script that 4xx's or 5xx's — which is NOT a JS bug: it fired against this exact
    // assertion on 2026-08-01 and again on 2026-08-03 (both flagged in #333/#338 as
    // unreproduced, left as-is rather than guessed at) with no accompanying app error,
    // and a flaky CDN asset says nothing about whether the selector's own code is
    // correct. Filtered out here so the assertion below means what it claims: no JS
    // error, not "zero network hiccups of any kind."
    const jsErrors: string[] = []
    const RESOURCE_LOAD_FAILURE = /^Failed to load resource: the server responded with a status of \d+/
    page.on('console', (message) => {
      if (message.type() === 'error' && !RESOURCE_LOAD_FAILURE.test(message.text())) {
        jsErrors.push(message.text())
      }
    })
    page.on('pageerror', (err) => jsErrors.push(`pageerror: ${err.message}`))
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
    expect(jsErrors).toEqual([])
  })
}

test('US invitation is a research conversation, not a catalog launch', async ({ page }) => {
  const response = await page.goto('/us')

  expect(response?.status()).toBe(200)
  await expect(page.getByTestId('us-invitation')).toBeVisible()
  await expect(page.getByTestId('us-research-cta')).toHaveAttribute(
    'href',
    /^mailto:daniel@miyagisanchez\.com\?subject=/,
  )
  // Title-cased in the source (`app/(site)/us/page.tsx` — `<ProofStep label=…>`), and
  // `toContainText` is case-SENSITIVE. The lowercase spelling here was a typo from the
  // day the pilot-proof copy landed (#328), so this asserted a string the page never
  // rendered and failed every nightly run from the moment the fixture lit it up.
  await expect(page.getByTestId('us-pilot-proof')).toContainText('Three consenting client shops')
  await expect(page.locator('[data-listing-id]')).toHaveCount(0)
  // Same case-sensitivity trap as the assertion above, one line later: the page
  // renders the title-cased eyebrow "Working hypothesis · United States". This one
  // stayed INVISIBLE until the pilot-proof typo above was fixed, because the test
  // died on that line first — so a single nightly failure was hiding two defects.
  await expect(page.locator('body')).toContainText('Working hypothesis')
})

test('US has no marketplace children while the market is invitation-only', async ({ page }) => {
  for (const path of ['/us/l/prod_market_boundary_fixture', '/us/s/shop-boundary-fixture', '/us/search', '/us/category']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByTestId('us-invitation'), path).toHaveCount(0)
    await expect(page.locator('[data-listing-id]'), path).toHaveCount(0)
  }
})
