import { test, expect } from '@playwright/test'

test.describe('seller acquisition · Mundial wedge', () => {
  test('anonymous visitor sees the page and reaches service onboarding with attribution', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/vende/mundial')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Captura al público global del Mundial/i }),
    ).toBeVisible()
    await expect(page.getByText(/Compruébalo tú mismo/i)).toBeVisible()

    await page.getByTestId('mundial-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('type') === 'service' &&
      url.searchParams.get('from') === 'mundial'
    ))
  })
})
