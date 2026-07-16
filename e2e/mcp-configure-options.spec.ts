import { test, expect } from '@playwright/test'

/**
 * mcp-parity-core S2 — `configure_listing_options`, the agent door to the
 * portal "Opciones" screen (priced option dimensions + per-combo prices +
 * quantity tiers through the backend's shared `updateSellerProduct`).
 *
 * Mirrors `mcp-launchpad-tools.spec.ts`'s boundary pattern: no `ms_agent_…`
 * test-token fixture exists yet for a live authed round-trip (the same owed
 * gap that spec already notes), so the testable boundary is discovery + the
 * auth rejection — `resolveAgentShop` rejects before the
 * `mcp.configure_options.enabled` flag check (auth → flag, the order every
 * seller handler uses), so the flag-OFF refusal itself needs the token
 * fixture and stays part of Daniel's smoke walkthrough (sprint-2.md).
 * The named backend failure modes (mutual exclusivity, restructure guard,
 * caps, tier-ladder errors) are enforced in
 * `apps/backend/src/api/store/_utils/seller-product-update.ts` and unit-
 * tested there; this handler surfaces those messages verbatim.
 */

const TOOL = 'configure_listing_options'

test.describe('configure_listing_options — discovery + schema', () => {
  test('tools/list advertises it with the full input schema', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === TOOL)
    expect(tool).toBeDefined()
    expect(tool!.inputSchema?.required).toEqual(['product_id'])
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['product_id', 'option_dimensions', 'variant_prices', 'variant_id', 'variant_tiers']),
    )
  })

  test('the schema documents the combo-key format an agent must construct', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { properties?: Record<string, { description?: string }> } }> =
      (await res.json()).result.tools
    const props = tools.find((t) => t.name === TOOL)?.inputSchema?.properties
    // The sorted "Título:Valor|Título:Valor" contract comes from the backend's
    // buildVariantComboKey — if the description stops naming it, an agent has
    // no way to build valid variant_prices keys.
    expect(props?.variant_prices?.description).toContain('Título:Valor')
  })
})

test.describe('configure_listing_options — auth boundary', () => {
  test('rejects a call with no Bearer token — never leaks scope, never a 500', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: TOOL, arguments: { product_id: 'prod_x', variant_tiers: [{ min_quantity: 1, max_quantity: null, amount: 1000 }] } },
      },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Unauthorized')
  })

  test('rejects a garbage Bearer token the same way', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: TOOL, arguments: { product_id: 'prod_x' } },
      },
      headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Unauthorized')
  })
})
