import { test, expect } from '@playwright/test'

/**
 * Living Shop · Sprint 5 — the studio preview cannot leak (Story 5.5).
 *
 * The studio previews the REAL public shop in an iframe with its pending draft
 * in the query string, so there is exactly one visual implementation. That
 * design has one danger, and this is the spec for it: a shared link carrying
 * `?preview=1&theme_mode=retro` must NOT repaint a merchant's storefront for the
 * visitor who follows it, or for a crawler that indexes it.
 *
 * The `api` project runs ANONYMOUS, which is precisely the attacker's position
 * here — so this is one of the few boundaries a deterministic gate can prove
 * end to end rather than argue structurally.
 *
 * Observed red by making `applyPreviewOverlay` skip its ownership lookup: the
 * anonymous request then rendered the overlay and the assertions below failed.
 */

async function anyPublicShopSlug(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  const res = await request.get('/api/ucp/catalog?limit=20')
  if (!res.ok()) return null
  const data = await res.json() as { products?: Array<{ seller?: { slug?: string } }> }
  return data.products?.find((p) => p.seller?.slug)?.seller?.slug ?? null
}

test.describe('preview overlay · anonymous cannot repaint a shop', () => {
  test('a preview link renders the SAVED shop, not the draft in the URL', async ({ request }) => {
    const slug = await anyPublicShopSlug(request)
    test.skip(!slug, 'FIXTURE UNAVAILABLE: the public catalog named no shop slug')

    const draft = new URLSearchParams({
      preview: '1',
      theme_mode: 'retro',
      theme_recipe: JSON.stringify({ corners: 'square', background: 'grid', accent: '#ff00ff' }),
      sections: JSON.stringify({ order: ['wall', 'shop'], hidden: ['collections', 'events', 'about', 'faq', 'policies'] }),
    })
    const withDraft = await request.get(`/mx/s/${slug}?${draft.toString()}`)
    const plain = await request.get(`/mx/s/${slug}`)

    expect(withDraft.status()).toBe(200)
    expect(plain.status()).toBe(200)

    const draftHtml = await withDraft.text()
    const plainHtml = await plain.text()

    // The overlay's most visible fingerprints. If any of these appears for an
    // anonymous caller, the ownership check is not doing its job.
    expect(draftHtml).not.toContain('data-shop-theme="retro"')
    expect(draftHtml).not.toContain('#ff00ff')
    // And the saved shop's own theme attribute is unchanged between the two.
    const themeOf = (html: string) => html.match(/data-shop-theme="([a-z]+)"/)?.[1] ?? null
    expect(themeOf(draftHtml)).toBe(themeOf(plainHtml))
  })

  test('a malformed draft degrades to the saved shop rather than erroring', async ({ request }) => {
    const slug = await anyPublicShopSlug(request)
    test.skip(!slug, 'FIXTURE UNAVAILABLE: the public catalog named no shop slug')
    const res = await request.get(`/mx/s/${slug}?preview=1&theme_recipe=%7Bnot-json&sections=%5B%5D`)
    expect(res.status()).toBe(200)
  })
})
