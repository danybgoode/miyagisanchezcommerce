import { expect, test } from '@playwright/test'

/**
 * Anonymous browser smoke for the `/acerca` about page (no auth, no money — NOT owed to Daniel).
 * Asserts the rendered page: es + en render, no section is a placeholder stub any more
 * (mobile-clerk-account-management fast-follow grounded the founder section), and the soft
 * CTA navigates to onboarding with the about attribution.
 */
test.describe('about · /acerca human page', () => {
  test('renders es, the grounded founder section, and routes the CTA to onboarding', async ({ page }) => {
    const res = await page.goto('/acerca')
    expect(res?.ok()).toBeTruthy()

    // Hero + a grounded section render in es-MX.
    await expect(page.getByRole('heading', { level: 1, name: /por qué vender aquí/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /¿Por qué vender aquí\?/i })).toBeVisible()

    // The founder section now renders real, grounded content — no stub badge anywhere.
    await expect(page.getByRole('heading', { name: /Quién está detrás/i })).toBeVisible()
    await expect(page.getByText('Daniel Vásquez')).toBeVisible()
    await expect(page.getByTestId('acerca-stub-founder')).toHaveCount(0)

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
    // Founder section's translation renders too — no stub copy left in either locale.
    await expect(page.getByRole('heading', { name: /Who is behind this/i })).toBeVisible()
    await expect(page.getByText('Daniel Vásquez')).toBeVisible()
    await expect(page.getByTestId('acerca-stub-founder')).toHaveCount(0)
  })
})
