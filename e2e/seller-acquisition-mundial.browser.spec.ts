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

    // S2 — the bespoke mundial hero shows the visible PromptBlock + copy button; no eyebrow badge.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await expect(page.getByTestId('mundial-prompt-copy')).toBeVisible()
    await page.getByTestId('mundial-prompt-copy').click()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toContain('https://miyagisanchez.com/vende/mundial')
    expect(clipboard).toContain('Mercado Libre')
    await expect(page.locator('.badge-promo')).toHaveCount(0)

    await page.getByTestId('mundial-primary-cta').click()
    await expect(page).toHaveURL((url) => (
      url.pathname === '/sell' &&
      url.searchParams.get('type') === 'service' &&
      url.searchParams.get('from') === 'mundial'
    ))
  })
})
