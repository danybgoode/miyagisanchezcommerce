import { test, expect } from '@playwright/test'

/**
 * panfleto-premium-shop · Sprint 2, Story 2.3 — the dress-up itself is
 * executed live via MCP tool calls (patch_store_configuration +
 * create_collection + update_listing) once Daniel approves the drafted copy
 * in sprint-2.md, not by this spec. The config round-trip logic
 * (announcement/hero/theme_preset/content.about/content.faq) is already
 * fully covered, pure-logic, by `mcp-store-config-presentation.spec.ts` —
 * this does NOT duplicate that. What it adds: a self-activating render-level
 * check that the three collections actually appear on the live storefront
 * once created. Skips gracefully before the dress-up has run.
 */

test.describe('panfleto dress-up — collections render on the storefront', () => {
  test('Historias / Convocatorias / Stickers collections appear on /s/panfleto once created', async ({ request }) => {
    const shopRes = await request.get('/s/panfleto', { maxRedirects: 0 })
    test.skip(shopRes.status() !== 200, 'panfleto shop not renamed/live in this environment yet')
    const html = await shopRes.text()
    const hasAnyCollection = ['Historias', 'Convocatorias', 'Stickers'].some((name) => html.includes(name))
    test.skip(!hasAnyCollection, 'collections not created yet (Story 2.3 dress-up pending)')

    for (const name of ['Historias', 'Convocatorias', 'Stickers']) {
      expect(html).toContain(name)
    }
  })

  test('the existing sticker product is curated into the Stickers collection', async ({ request }) => {
    const res = await request.get('/api/ucp/catalog?seller_slug=panfleto&limit=50')
    test.skip(!res.ok(), 'panfleto shop not renamed/live in this environment yet')
    const data = await res.json()
    const sticker = (data.items ?? []).find((i: { title?: string }) => i.title === 'Stickers personalizados')
    test.skip(!sticker, 'sticker product not found under the panfleto seller slug yet')
    // `collections` on the UCP catalog item is the SHORT slug (namespaced
    // handle prefix stripped, then lowercased by createSellerCollection's own
    // slugify) — not the display name. "Stickers" -> "stickers".
    expect(sticker.collections ?? []).toContain('stickers')
  })
})
