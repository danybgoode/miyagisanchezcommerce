import { expect, test } from '@playwright/test'

test.describe('seller acquisition · local business page', () => {
  test('anonymous local merchant sees the print bridge and reaches attributed onboarding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/vende/negocios?utm_source=browser-smoke')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Tu negocio de la esquina/i }),
    ).toBeVisible()
    await expect(page.getByText(/ahora tambien en linea/i)).toBeVisible()
    await expect(page.getByText(/Mexico-86/i).first()).toBeVisible()
    await expect(page.getByText(/QR para tu mostrador/i)).toBeVisible()

    await page.getByTestId('negocios-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('from') === 'negocios' &&
      url.searchParams.get('utm_source') === 'browser-smoke'
    ))
  })
})
