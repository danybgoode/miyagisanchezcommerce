import { expect, test } from '@playwright/test'

// A real not-found request is the contract: Next may render the 404 component
// under an internal pathname, so a source-only check missed the US link drift.
for (const market of ['mx', 'us'] as const) {
  test(`${market} missing page keeps Explore in the requested market`, async ({ request }) => {
    const response = await request.get(`/${market}/codex-recovery-market-check`, {
      headers: { Accept: 'text/html' },
    })
    expect(response.status()).toBe(404)
    const html = await response.text()
    expect(html).toContain('No encontramos esta página')
    expect(html).toContain(`href="https://miyagisanchez.com/${market}/l">Explorar anuncios</a>`)
  })
}
