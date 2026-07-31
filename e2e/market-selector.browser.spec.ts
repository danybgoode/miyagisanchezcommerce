import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`root selector chooses Mexico without an automatic redirect (${viewport.name})`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
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
    expect(consoleErrors).toEqual([])
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
  await expect(page.getByTestId('us-pilot-proof')).toContainText('three consenting client shops')
  await expect(page.locator('[data-listing-id]')).toHaveCount(0)
  await expect(page.locator('body')).toContainText('working hypothesis')
})

test('US has no marketplace children while the market is invitation-only', async ({ page }) => {
  for (const path of ['/us/l/prod_market_boundary_fixture', '/us/s/shop-boundary-fixture', '/us/search', '/us/category']) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByTestId('us-invitation'), path).toHaveCount(0)
    await expect(page.locator('[data-listing-id]'), path).toHaveCount(0)
  }
})
