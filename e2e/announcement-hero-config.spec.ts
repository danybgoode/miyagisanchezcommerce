import { expect, test } from '@playwright/test'
import { validateConfig } from '../lib/settings-import'

/**
 * Own-shop premium presentation (epic 07, Sprint 1) — Stories 1.1/1.2 field
 * validation, exercised through `validateConfig()` (the same seam
 * Storefront-as-Code + the MCP `patch_store_configuration` tool both call —
 * see `lib/settings-import.ts` and `e2e/mcp-store-config-presentation.spec.ts`
 * for the full config round-trip).
 */
test.describe('own-shop premium presentation — announcement + hero validation (Sprint 1)', () => {
  test('a valid announcement (text + link) is applied', () => {
    const { patch, blocks } = validateConfig({ profile: { announcement: { text: 'Envío gratis desde $500', link: 'https://miyagisanchez.com' } } })
    expect(patch.settings?.announcement).toEqual({ text: 'Envío gratis desde $500', link: 'https://miyagisanchez.com' })
    expect(blocks[0].appliedFields).toContain('announcement')
  })

  test('an empty announcement text is rejected — not applied, issue reported', () => {
    const { patch, blocks } = validateConfig({ profile: { announcement: { text: '' } } })
    expect(patch.settings?.announcement).toBeUndefined()
    expect(blocks[0].issues.some(i => i.includes('announcement.text'))).toBe(true)
  })

  test('a non-http(s) announcement link drops the whole announcement, with an issue', () => {
    const { patch, blocks } = validateConfig({ profile: { announcement: { text: 'Oferta', link: 'javascript:alert(1)' } } })
    expect(patch.settings?.announcement).toBeUndefined()
    expect(blocks[0].issues.some(i => i.includes('announcement.link'))).toBe(true)
  })

  test('hero mode "listings" caps pinned_listing_ids at 4', () => {
    const { patch } = validateConfig({
      profile: { hero: { mode: 'listings', pinned_listing_ids: ['a', 'b', 'c', 'd', 'e', 'f'] } },
    })
    expect(patch.settings?.hero).toEqual({ mode: 'listings', pinned_listing_ids: ['a', 'b', 'c', 'd'] })
  })

  test('hero mode "promo" keeps only http(s) image/link, drops the rest', () => {
    const { patch } = validateConfig({
      profile: { hero: { mode: 'promo', promo_image_url: 'not-a-url', promo_cta_text: 'Ver más', promo_cta_link: 'https://x.com' } },
    })
    expect(patch.settings?.hero).toEqual({ mode: 'promo', promo_cta_text: 'Ver más', promo_cta_link: 'https://x.com' })
  })

  test('an invalid hero.mode is rejected with an issue, nothing applied', () => {
    const { patch, blocks } = validateConfig({ profile: { hero: { mode: 'bogus' as never } } })
    expect(patch.settings?.hero).toBeUndefined()
    expect(blocks[0].issues.some(i => i.includes('hero.mode'))).toBe(true)
  })

  test('a valid theme_preset key is applied; an invalid one (including the "default" sentinel) is rejected', () => {
    const valid = validateConfig({ profile: { theme_preset: 'papel' } })
    expect(valid.patch.settings?.theme_preset).toBe('papel')

    const invalid = validateConfig({ profile: { theme_preset: 'not-a-real-preset' } })
    expect(invalid.patch.settings?.theme_preset).toBeUndefined()
    expect(invalid.blocks[0].issues.some(i => i.includes('theme_preset'))).toBe(true)

    // "default" is a registry entry (the Diseño picker's "none" option) but is
    // never itself persisted — Diseño converts it to `null` before saving, and
    // an agent sending it explicitly is rejected the same way an unknown key is.
    const defaultKey = validateConfig({ profile: { theme_preset: 'default' } })
    expect(defaultKey.patch.settings?.theme_preset).toBeUndefined()
  })

  test('absent announcement/hero/theme_preset keys leave the storefront unchanged (no keys in the patch)', () => {
    const { patch } = validateConfig({ profile: { name: 'Mi tienda' } })
    expect(patch.settings?.announcement).toBeUndefined()
    expect(patch.settings?.hero).toBeUndefined()
    expect(patch.settings?.theme_preset).toBeUndefined()
  })
})
