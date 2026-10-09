import { expect, test } from '@playwright/test'

// The static HTML must offer a safe route before the browser can inspect the
// original URL. Browser coverage checks the market-specific link after hydration.
for (const market of ['mx', 'us'] as const) {
  test(`${market} missing page stays a 404 with a safe no-JS recovery link`, async ({ request }) => {
    const response = await request.get(`/${market}/codex-recovery-market-check`, {
      headers: { Accept: 'text/html' },
    })
    expect(response.status()).toBe(404)
    const html = await response.text()
    expect(html).toContain('No encontramos esta página')
    expect(html).toContain('href="https://miyagisanchez.com">Explorar anuncios</a>')
  })
}
