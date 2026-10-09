import { expect, test } from '@playwright/test'

for (const market of ['mx', 'us'] as const) {
  test(`${market} missing page links to its original market after hydration`, async ({ page }) => {
    const response = await page.goto(`/${market}/codex-recovery-market-check`)
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('link', { name: 'Explorar anuncios' }))
      .toHaveAttribute('href', `https://miyagisanchez.com/${market}/l`)
  })
}
