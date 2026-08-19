import { expect, test } from '@playwright/test'
import { resolvedSellTarget } from './_helpers/seller-acquisition'

test.describe('seller acquisition · services page', () => {
  test('anonymous services pro sees booking hooks and reaches service onboarding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const res = await page.goto('/mx/vende/servicios?utm_source=browser-smoke')
    expect(res?.ok()).toBeTruthy()

    await expect(
      page.getByRole('heading', { name: /Cobra y agenda sin complicaciones/i }),
    ).toBeVisible()
    await expect(page.getByText(/Cal.com/i).first()).toBeVisible()
    await expect(page.getByText(/Tipo servicio/i)).toBeVisible()
    // "Cobra directo" now appears multiple times on the page; assert presence via .first().
    await expect(page.getByText(/Cobra directo/i).first()).toBeVisible()

    await page.getByTestId('servicios-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      resolvedSellTarget(url)?.pathname === '/sell' &&
      resolvedSellTarget(url)?.searchParams.get('type') === 'service' &&
      resolvedSellTarget(url)?.searchParams.get('from') === 'servicios' &&
      resolvedSellTarget(url)?.searchParams.get('utm_source') === 'browser-smoke'
    ))
  })
})
