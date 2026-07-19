import { test, expect, type APIRequestContext } from '@playwright/test'

const CATALOG_PAGE_SIZE = 50

type CatalogItem = {
  id?: string
  shop?: { slug?: unknown }
}

/**
 * Read the complete public catalog rather than trusting the first result. The
 * Store endpoint paginates on `page`, which the UCP route forwards unchanged.
 * A seller-less listing can otherwise hide on a later page while this embed
 * gate stays green.
 */
async function readCatalog(request: APIRequestContext): Promise<CatalogItem[]> {
  const items: CatalogItem[] = []
  let pageNumber = 1
  let total = 0

  do {
    const res = await request.get(`/api/ucp/catalog?limit=${CATALOG_PAGE_SIZE}&page=${pageNumber}`)
    expect(res.ok(), `catalog page ${pageNumber}`).toBeTruthy()

    const page = await res.json() as { items?: unknown; total?: unknown }
    expect(Array.isArray(page.items), `catalog page ${pageNumber} returns items`).toBeTruthy()
    expect(typeof page.total, `catalog page ${pageNumber} returns total`).toBe('number')

    const pageItems = page.items as CatalogItem[]
    items.push(...pageItems)
    total = page.total as number

    // The final page must complete the advertised total. Before then, a full
    // page is required; otherwise we would silently leave later listings
    // unchecked if pagination returned a short page prematurely.
    if (items.length >= total) {
      expect(items.length, 'catalog pagination returned every item').toBe(total)
      break
    }

    expect(pageItems, `catalog page ${pageNumber} is complete`).toHaveLength(CATALOG_PAGE_SIZE)
    pageNumber += 1
  } while (items.length < total)

  return items
}

/**
 * Embeddable Widget · Sprint 2 (US-5) — full-shop iframe surface.
 * The whole point is that ANY site can frame /embed/s/[slug], so the route must
 * carry `Content-Security-Policy: frame-ancestors *` and must not be blocked by
 * a restrictive X-Frame-Options. Read-only.
 *
 * The white-label render (no platform chrome) + buy-breaks-out-of-frame are
 * visual/auth behaviours covered by live confirmation (the demo page + Daniel),
 * not asserted here.
 */
test.describe('Embed full-shop — framable surface', () => {
  test('the /embed/ route is served frame-ancestors * (framable anywhere)', async ({ request }) => {
    // Header is applied by next.config to the whole /embed/* path, so it holds
    // even for an unknown slug (no dependency on a seeded shop).
    const res = await request.get('/embed/s/__smoke__', { headers: { Accept: 'text/html' } })
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp).toContain('frame-ancestors')
    // Must NOT be hard-blocked from framing.
    expect(res.headers()['x-frame-options'] ?? '').not.toMatch(/deny|sameorigin/i)
  })

  test('renders a real shop storefront when one exists', async ({ request }) => {
    // A catalog with no listings has no storefront to render. Any populated
    // catalog must expose a real shop slug for EVERY returned listing — do this
    // before the skip so an orphan on any page fails loudly, not silently.
    const catalog = await readCatalog(request)
    test.skip(catalog.length === 0, 'no active listings in this environment')

    for (const [index, item] of catalog.entries()) {
      expect(item.shop?.slug, `catalog item ${item.id ?? index} at index ${index} has a shop slug`).toBeTruthy()
    }

    const slug = catalog[0].shop?.slug as string

    const res = await request.get(`/embed/s/${slug}`, { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-security-policy'] ?? '').toContain('frame-ancestors')

    // White-label: the platform chrome (root-layout header) must be suppressed
    // for embed-tagged requests. The header's search placeholder is a unique
    // marker that only the platform chrome renders — it must be absent.
    const html = await res.text()
    expect(html).not.toContain('¿Qué estás buscando?')
  })
})
