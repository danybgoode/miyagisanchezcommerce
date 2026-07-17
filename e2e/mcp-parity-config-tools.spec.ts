import { test, expect } from '@playwright/test'
import { validateSlug, buildSlugAliasHistory, SLUG_ALIAS_TTL_MS, MAX_PREVIOUS_SLUGS } from '../lib/slug'

/**
 * mcp-parity-config S1+S2 — the 12 config-wrapper seller tools:
 *   update_collection / delete_collection / reorder_collections /
 *   set_listing_repuve / set_shop_slug / set_notification_preferences /
 *   create_content / update_content / delete_content /
 *   link_telegram / unlink_telegram / test_telegram
 *
 * Mirrors `mcp-create-collection.spec.ts`'s pattern: no `ms_agent_…`
 * test-token fixture exists yet (the same owed gap every seller-tool spec
 * notes), so live coverage stops at the auth boundary — `resolveAgentShop`
 * rejects before any per-tool validation runs. The per-tool logic that IS
 * pure (slug format rules, the alias-history builder `set_shop_slug` shares
 * with the portal PATCH) is tested directly. Dispatch⇄manifest sync is
 * enforced by `mcp-tool-dispatch-parity.spec.ts` for all 12 automatically.
 */

const NEW_TOOLS = [
  { name: 'update_collection', args: { collection_slug: 'x', name: 'Historias' } },
  { name: 'delete_collection', args: { collection_slug: 'x' } },
  { name: 'reorder_collections', args: { ordered_slugs: ['x'] } },
  { name: 'set_listing_repuve', args: { product_id: 'prod_x', status: 'sin_reporte' } },
  { name: 'set_shop_slug', args: { slug: 'tienda-nueva' } },
  { name: 'set_notification_preferences', args: { channel: 'email', event_group: 'orders', enabled: true } },
  { name: 'create_content', args: { title: 'Hola' } },
  { name: 'update_content', args: { content_id: 'x', title: 'Hola' } },
  { name: 'delete_content', args: { content_id: 'x' } },
  { name: 'link_telegram', args: {} },
  { name: 'unlink_telegram', args: {} },
  { name: 'test_telegram', args: {} },
] as const

test.describe('parity-config tools — discovery', () => {
  test('tools/list advertises all 12 tools with their required fields', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[] } }> =
      (await res.json()).result.tools
    const byName = new Map(tools.map((t) => [t.name, t]))

    for (const { name } of NEW_TOOLS) {
      expect(byName.has(name), `tools/list should include ${name}`).toBe(true)
    }
    expect(byName.get('update_collection')!.inputSchema?.required).toEqual(['collection_slug', 'name'])
    expect(byName.get('delete_collection')!.inputSchema?.required).toEqual(['collection_slug'])
    expect(byName.get('reorder_collections')!.inputSchema?.required).toEqual(['ordered_slugs'])
    expect(byName.get('set_listing_repuve')!.inputSchema?.required).toEqual(['product_id', 'status'])
    expect(byName.get('set_shop_slug')!.inputSchema?.required).toEqual(['slug'])
    expect(byName.get('set_notification_preferences')!.inputSchema?.required).toEqual(['channel', 'event_group', 'enabled'])
    expect(byName.get('create_content')!.inputSchema?.required).toEqual(['title'])
    expect(byName.get('update_content')!.inputSchema?.required).toEqual(['content_id'])
    expect(byName.get('delete_content')!.inputSchema?.required).toEqual(['content_id'])
  })

  test('GET /api/ucp/manifest lists all 12 in the aggregate mcp tool list', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    const manifest = await res.json()
    for (const { name } of NEW_TOOLS) {
      expect(manifest.endpoints.mcp.mcp_tools, `manifest should include ${name}`).toContain(name)
    }
  })
})

test.describe('parity-config tools — auth boundary', () => {
  for (const { name, args } of NEW_TOOLS) {
    test(`${name} rejects a garbage Bearer token — never leaks scope, never a 500`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
        headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
      })
      expect(res.status()).toBeLessThan(500)
      const body = await res.json()
      const text: string = body.result.content[0].text
      expect(text).toContain('Unauthorized')
      expect(body.result.isError).toBe(true)
    })
  }

  test('a call with no Bearer token rejects the same way', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set_shop_slug', arguments: { slug: 'tienda-nueva' } } },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.content[0].text).toContain('Unauthorized')
  })
})

test.describe('set_shop_slug — slug rules (pure, shared with the portal)', () => {
  test('validateSlug rejects short, long, malformed, and reserved candidates', () => {
    expect(validateSlug('ab').valid).toBe(false)
    expect(validateSlug('x'.repeat(41)).valid).toBe(false)
    expect(validateSlug('-tienda').valid).toBe(false)
    expect(validateSlug('tienda-').valid).toBe(false)
    expect(validateSlug('Tienda').valid).toBe(false)
    expect(validateSlug('admin').valid).toBe(false)
    expect(validateSlug('mschz').valid).toBe(false)
  })

  test('validateSlug accepts a normal slug', () => {
    expect(validateSlug('mi-tienda-2').valid).toBe(true)
  })
})

test.describe('buildSlugAliasHistory — alias history (pure, shared with the portal)', () => {
  const NOW = Date.parse('2026-07-16T00:00:00Z')
  const future = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString()
  const past = new Date(NOW - 1000).toISOString()

  test('adds the old slug with a 90-day TTL', () => {
    const { previousSlugs, previousSlugKeys } = buildSlugAliasHistory({}, 'vieja', 'nueva', NOW)
    expect(previousSlugs).toHaveLength(1)
    expect(previousSlugs[0].slug).toBe('vieja')
    expect(Date.parse(previousSlugs[0].until)).toBe(NOW + SLUG_ALIAS_TTL_MS)
    expect(previousSlugKeys).toEqual(['vieja'])
  })

  test('keeps non-expired entries, drops expired ones', () => {
    const meta = { previous_slugs: [{ slug: 'viva', until: future }, { slug: 'muerta', until: past }] }
    const { previousSlugKeys } = buildSlugAliasHistory(meta, 'vieja', 'nueva', NOW)
    expect(previousSlugKeys).toEqual(['viva', 'vieja'])
  })

  test('drops an alias equal to the new slug (it is live again)', () => {
    const meta = { previous_slugs: [{ slug: 'nueva', until: future }] }
    const { previousSlugKeys } = buildSlugAliasHistory(meta, 'vieja', 'nueva', NOW)
    expect(previousSlugKeys).toEqual(['vieja'])
  })

  test(`caps the list at ${MAX_PREVIOUS_SLUGS}`, () => {
    const meta = {
      previous_slugs: Array.from({ length: 12 }, (_, i) => ({ slug: `s${i}`, until: future })),
    }
    const { previousSlugs } = buildSlugAliasHistory(meta, 'vieja', 'nueva', NOW)
    expect(previousSlugs).toHaveLength(MAX_PREVIOUS_SLUGS)
    expect(previousSlugs[MAX_PREVIOUS_SLUGS - 1].slug).toBe('vieja')
  })
})
