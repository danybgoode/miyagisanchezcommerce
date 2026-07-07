import { test, expect } from '@playwright/test'

/**
 * ml-orders-native S3 · US-9 — agent-surface parity for order reads. The scope
 * doc originally framed this as "verify-not-build" (assuming a seller MCP
 * order tool already existed) — direct code research found NO such tool
 * anywhere in `app/api/ucp/mcp/route.ts`, so `list_orders` is real new build.
 * Mirrors `seller-listing-tools.spec.ts`'s pattern: guards the auth boundary,
 * read-only, never mutates. No `ms_agent_…` test-token fixture exists yet for
 * a full live round-trip (a real seeded shop + a real materialized ML order)
 * — that's owed to Daniel, same fixture gap `agent-connector.spec.ts` notes.
 */

test.describe('list_orders MCP tool', () => {
  test('tools/list advertises list_orders with the expected filter shape', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === 'list_orders')
    expect(tool).toBeDefined()
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['status', 'source', 'limit']),
    )
  })

  test('rejects a call with no Bearer token — never leaks scope, never a 500', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_orders', arguments: {} } },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(text).toContain('Unauthorized')
  })

  test('rejects a call with a garbage Bearer token the same way', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_orders', arguments: {} } },
      headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(text).toContain('Unauthorized')
  })
})

test.describe('list_orders manifest wiring', () => {
  test('GET /api/ucp/manifest lists list_orders in the seller_orders endpoint AND the aggregate mcp tool list', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    const manifest = await res.json()
    expect(manifest.endpoints.seller_orders.mcp_tools).toContain('list_orders')
    expect(manifest.endpoints.mcp.mcp_tools).toContain('list_orders')
    expect(manifest.capabilities).toContain('seller_orders')
  })
})
