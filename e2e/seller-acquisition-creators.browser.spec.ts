import { expect, test } from '@playwright/test'

test.describe('seller acquisition · Creator page', () => {
  test('anonymous creator sees the migration pitch and reaches attributed onboarding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/vende/creadores?utm_source=browser-smoke')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Deja de pagar comisiones de Shopify/i }),
    ).toBeVisible()
    await expect(page.getByText(/perder ventas en los DMs/i)).toBeVisible()
    await expect(page.getByText(/Trae tu catalogo/i).first()).toBeVisible()
    await expect(page.getByText(/subdominio, dominio propio y widget/i)).toBeVisible()

    await page.getByTestId('creadores-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('from') === 'creadores' &&
      url.searchParams.get('utm_source') === 'browser-smoke'
    ))
  })

  test('B variant swaps creator headline and tags conversion links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/vende/creadores?v=b&utm_source=browser-smoke')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Tu catalogo de Instagram merece una tienda propia/i }),
    ).toBeVisible()
    // The (shell) layout adds an outer <main>; target the page's variant-tagged main.
    await expect(page.locator('main[data-seller-variant]')).toHaveAttribute('data-seller-variant', 'b')

    await page.getByTestId('creadores-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('from') === 'creadores' &&
      url.searchParams.get('v') === 'b' &&
      url.searchParams.get('utm_source') === 'browser-smoke'
    ))
  })
})
