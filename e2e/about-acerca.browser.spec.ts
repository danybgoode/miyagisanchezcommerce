import { expect, test } from '@playwright/test'

/**
 * Anonymous browser smoke for the `/acerca` about page (no auth, no money — NOT owed to Daniel).
 * Asserts the rendered page: es + en render, stubs show the "próximamente" badge, and the soft CTA
 * navigates to onboarding with the about attribution.
 */
test.describe('about · /acerca human page', () => {
  test('renders es, the founder/pricing stubs, and routes the CTA to onboarding', async ({ page }) => {
    const res = await page.goto('/acerca')
    expect(res?.ok()).toBeTruthy()

    // Hero + a grounded section render in es-MX.
    await expect(page.getByRole('heading', { level: 1, name: /por qué vender aquí/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /¿Por qué vender aquí\?/i })).toBeVisible()

    // The founder section still renders as a clearly-marked placeholder, never fake content.
    // (Pricing shipped real content — about-content.ts pricing is now stub:false — so founder
    // is the only remaining "próximamente" stub.)
    await expect(page.getByTestId('acerca-stub-founder')).toBeVisible()

    // Soft CTA → /sell?from=acerca.
    await page.getByTestId('acerca-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' && url.searchParams.get('from') === 'acerca'
    ))
  })

  test('renders the faithful English translation under ?lang=en', async ({ page }) => {
    const res = await page.goto('/acerca?lang=en')
    expect(res?.ok()).toBeTruthy()

    await expect(page.getByRole('heading', { name: /^Why sell here\?$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^What is miyagisanchez\.com\?$/i })).toBeVisible()
    // Stub copy localizes too.
    await expect(page.getByTestId('acerca-stub-founder')).toHaveText(/coming soon/i)
  })
})
