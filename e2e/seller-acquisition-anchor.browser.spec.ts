import { expect, test } from '@playwright/test'

test.describe('seller acquisition · anchor page', () => {
  test('anonymous visitor sees the router and reaches onboarding with attribution', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/vende?utm_source=browser-smoke')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Vende lo que sea en Mexico/i }),
    ).toBeVisible()
    await expect(page.getByText(/preguntale a Claude/i)).toBeVisible()
    await expect(page.getByTestId('vende-router-creadores')).toBeVisible()

    await page.getByTestId('vende-router-creadores').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/vende/creadores' &&
      url.searchParams.get('utm_source') === 'browser-smoke'
    ))

    await page.goto('/vende?utm_source=browser-smoke')
    await page.getByTestId('vende-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('from') === 'vende' &&
      url.searchParams.get('utm_source') === 'browser-smoke'
    ))
  })
})
