import { test, expect } from '@playwright/test'
import { buildQuery } from '../lib/listing-query'

/**
 * cars-vertical · Sprint 1 — the new autos facet params reach the web + agent
 * surfaces identically (Story 1.2 web + Story 1.3 UCP/MCP parity).
 *
 * Two layers (both in the `api` gate):
 *  • pure-logic — buildQuery forwards `model` (the one net-new filter param).
 *  • round-trip — the new params are documented in the manifest, declared on the
 *    MCP `search_listings` tool, and actually reach the backend on the catalog
 *    route (impossible value → total 0). Data-resilient: asserts the contract,
 *    not that prod holds any particular car.
 */

test.describe('cars · buildQuery forwards the model facet param', () => {
  test('model is forwarded when present, omitted when absent', () => {
    expect(buildQuery({ category: 'autos', model: 'Jetta' })).toContain('model=Jetta')
    expect(buildQuery({ category: 'autos' })).not.toContain('model=')
  })

  test('model rides alongside the other autos facets', () => {
    const p = new URLSearchParams(buildQuery({
      category: 'autos', brand: 'Volkswagen', model: 'Jetta', year_from: '2018', km_to: '80000',
    }))
    expect(p.get('brand')).toBe('Volkswagen')
    expect(p.get('model')).toBe('Jetta')
    expect(p.get('year_from')).toBe('2018')
    expect(p.get('km_to')).toBe('80000')
  })
})

test.describe('cars · UCP manifest documents every autos facet param', () => {
  test('endpoints.catalog.params lists the reconciled autos facets + sorts', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.ok()).toBeTruthy()
    const params = (await res.json()).endpoints.catalog.params
    for (const key of ['brand', 'model', 'year_from', 'year_to', 'km_from', 'km_to', 'transmission', 'fuel']) {
      expect(params, `manifest catalog.params is missing "${key}"`).toHaveProperty(key)
    }
    expect(params.sort).toContain('year_desc')
    expect(params.sort).toContain('marca')
  })
})

test.describe('cars · MCP search_listings declares every autos facet param', () => {
  test('tools/list inputSchema exposes model/km/transmission/fuel', async ({ request }) => {
    const list = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(list.ok()).toBeTruthy()
    const tools = (await list.json()).result.tools as Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>
    const search = tools.find((t) => t.name === 'search_listings')
    expect(search, 'search_listings tool must be declared').toBeTruthy()
    const props = search!.inputSchema.properties
    for (const key of ['brand', 'model', 'year_from', 'year_to', 'km_from', 'km_to', 'transmission', 'fuel']) {
      expect(props, `search_listings inputSchema is missing "${key}"`).toHaveProperty(key)
    }
  })
})

test.describe('cars · catalog facet params actually reach the backend', () => {
  test('an impossible model narrows the autos set to zero (proves model is applied)', async ({ request }) => {
    const res = await request.get('/api/ucp/catalog?category=autos&model=__nope__&limit=50')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  test('a category=autos query without facets returns a superset (sanity)', async ({ request }) => {
    const all = await request.get('/api/ucp/catalog?category=autos&limit=50')
    expect(all.ok()).toBeTruthy()
    const narrowed = await request.get('/api/ucp/catalog?category=autos&model=__nope__&limit=50')
    expect((await narrowed.json()).total).toBeLessThanOrEqual((await all.json()).total)
  })
})
