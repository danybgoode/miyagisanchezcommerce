import { test, expect } from '@playwright/test'

/**
 * panfleto-premium-shop · Sprint 2 — `create_collection` MCP tool. Closes a
 * real gap: `list_my_collections` previously told an agent to create
 * collections in the portal UI, since no create path existed via MCP. Mirrors
 * `mcp-order-read.spec.ts`'s pattern for a new seller-scoped mutation tool: no
 * `ms_agent_…` test-token fixture exists yet for a full live round-trip (a
 * real seeded shop) — that's the same owed gap `agent-connector.spec.ts` and
 * `mcp-order-read.spec.ts` already note — so this guards the auth boundary,
 * the tool's own input validation, and manifest wiring; the "creates a real
 * Medusa category" behavior is covered on the backend by
 * `seller-collections.unit.spec.ts` (the shared `createSellerCollection`
 * logic the internal route calls) plus `mcp-tool-dispatch-parity.spec.ts`
 * (every declared tool has a dispatch case, incl. this one).
 */

test.describe('create_collection MCP tool', () => {
  test('tools/list advertises create_collection with a required name field', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === 'create_collection')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema?.required).toEqual(['name'])
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).toEqual(expect.arrayContaining(['name']))
  })

  test('rejects a call with no Bearer token — never leaks scope, never a 500', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_collection', arguments: { name: 'Historias' } } },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(text).toContain('Unauthorized')
  })

  test('rejects a call with a garbage Bearer token the same way', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_collection', arguments: { name: 'Historias' } } },
      headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(text).toContain('Unauthorized')
  })
})

test.describe('create_collection manifest wiring', () => {
  test('GET /api/ucp/manifest lists create_collection in the aggregate mcp tool list', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    const manifest = await res.json()
    expect(manifest.endpoints.mcp.mcp_tools).toContain('create_collection')
  })
})
