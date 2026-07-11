import { expect, test } from '@playwright/test'
import { validateConfig } from '../lib/settings-import'
import { buildStoreConfigSnapshot } from '../lib/store-config'

/**
 * Own-shop premium presentation (epic 07, Sprint 1, Story 1.4) — a full
 * config-parity round-trip for the three new keys, pure-logic (no live agent
 * token needed): manifest → `validateConfig` (what `patch_store_configuration`
 * calls) → simulated persisted shop metadata → `buildStoreConfigSnapshot`
 * (what `get_store_configuration` calls, `app/api/ucp/mcp/route.ts`).
 */
test.describe('own-shop premium presentation — MCP store-config round-trip (Sprint 1)', () => {
  test('patch_store_configuration -> get_store_configuration round-trips announcement/hero/theme_preset', () => {
    const manifest = {
      profile: {
        announcement: { text: 'Envío gratis desde $500', link: 'https://miyagisanchez.com' },
        hero: { mode: 'listings' as const, pinned_listing_ids: ['prod_1', 'prod_2'] },
        theme_preset: 'pizarra',
      },
    }

    const { patch } = validateConfig(manifest)
    expect(patch.settings).toBeDefined()

    // Simulate the PATCH route's deep-merge landing on the shop row, then read
    // it back exactly how get_store_configuration does.
    const shop = { name: 'Tienda de prueba', metadata: { settings: patch.settings } }
    const snapshot = buildStoreConfigSnapshot(shop)

    expect(snapshot.configuration.profile?.announcement).toEqual({ text: 'Envío gratis desde $500', link: 'https://miyagisanchez.com' })
    expect(snapshot.configuration.profile?.hero).toEqual({ mode: 'listings', pinned_listing_ids: ['prod_1', 'prod_2'] })
    expect(snapshot.configuration.profile?.theme_preset).toBe('pizarra')
    expect(snapshot.configured_blocks).toContain('profile')
  })

  test('an invalid theme_preset is rejected before it ever reaches the stored shop', () => {
    const { patch, blocks } = validateConfig({ profile: { theme_preset: 'not-a-real-preset' } })
    expect(patch.settings?.theme_preset).toBeUndefined()
    expect(blocks[0].issues).toEqual(expect.arrayContaining([expect.stringContaining('theme_preset')]))
  })

  test('a shop with none of the three keys set omits them from the snapshot (today\'s storefront)', () => {
    const snapshot = buildStoreConfigSnapshot({ name: 'Tienda vacía', metadata: { settings: {} } })
    expect(snapshot.configuration.profile?.announcement).toBeUndefined()
    expect(snapshot.configuration.profile?.hero).toBeUndefined()
    expect(snapshot.configuration.profile?.theme_preset).toBeUndefined()
  })

  test('patch_store_configuration -> get_store_configuration round-trips content.about/content.faq (panfleto-premium-shop S2)', () => {
    const manifest = {
      content: {
        about: { body: 'panfleto es una editorial que publica relatos de terror.' },
        faq: { items: [{ question: '¿Qué publica panfleto?', answer: 'Relatos de terror de autores mexicanos y latinoamericanos.' }] },
      },
    }

    const { patch } = validateConfig(manifest)
    expect(patch.settings).toBeDefined()

    const shop = { name: 'panfleto', metadata: { settings: patch.settings } }
    const snapshot = buildStoreConfigSnapshot(shop)

    expect(snapshot.configuration.content?.about).toEqual({ body: 'panfleto es una editorial que publica relatos de terror.' })
    expect(snapshot.configuration.content?.faq?.items).toEqual([
      { question: '¿Qué publica panfleto?', answer: 'Relatos de terror de autores mexicanos y latinoamericanos.' },
    ])
    expect(snapshot.configured_blocks).toContain('content')
  })

  test('content.about.body over 600 chars is rejected before it ever reaches the stored shop', () => {
    const { patch, blocks } = validateConfig({ content: { about: { body: 'x'.repeat(601) } } })
    expect(patch.settings?.about).toBeUndefined()
    expect(blocks[0].issues).toEqual(expect.arrayContaining([expect.stringContaining('content.about')]))
  })

  test('a FAQ item exceeding the question/answer length cap is dropped, not truncated silently', () => {
    const { patch, blocks } = validateConfig({
      content: { faq: { items: [{ question: 'x'.repeat(141), answer: 'ok' }] } },
    })
    expect(patch.settings?.faq).toBeUndefined()
    expect(blocks[0].issues).toEqual(expect.arrayContaining([expect.stringContaining('content.faq')]))
  })

  test('an agent CAN clear a previously-set announcement/hero/theme_preset via patch_store_configuration', () => {
    // First set all three...
    const set = validateConfig({
      profile: {
        announcement: { text: 'Oferta' },
        hero: { mode: 'listings', pinned_listing_ids: ['prod_1'] },
        theme_preset: 'papel',
      },
    })
    const shopWithConfig = { name: 'Tienda', metadata: { settings: set.patch.settings } }
    const configured = buildStoreConfigSnapshot(shopWithConfig)
    expect(configured.configuration.profile?.announcement).toBeDefined()

    // ...then clear all three with an explicit null, simulating the deep-merge
    // landing on the already-configured shop.
    const clear = validateConfig({ profile: { announcement: null, hero: null, theme_preset: null } })
    const shopAfterClear = {
      name: 'Tienda',
      metadata: { settings: { ...(set.patch.settings as Record<string, unknown>), ...(clear.patch.settings as Record<string, unknown>) } },
    }
    const cleared = buildStoreConfigSnapshot(shopAfterClear)
    expect(cleared.configuration.profile?.announcement).toBeUndefined()
    expect(cleared.configuration.profile?.hero).toBeUndefined()
    expect(cleared.configuration.profile?.theme_preset).toBeUndefined()
  })
})
