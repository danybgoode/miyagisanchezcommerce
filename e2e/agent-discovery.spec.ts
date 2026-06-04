import { test, expect } from '@playwright/test'

/**
 * Agent-facing discovery surface (epic 07 · Agent Connection).
 * Guards the public docs against drifting from the real API again — the exact
 * checks we used to run by hand with curl. All read-only (no mutations).
 */
test.describe('Agent discovery surface', () => {
  test('UCP manifest advertises real capabilities + all MCP tools incl. seller tools', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    expect(res.ok()).toBeTruthy()
    const m = await res.json()
    expect(m.capabilities).toEqual(
      expect.arrayContaining(['seller_configuration', 'scheduling', 'buyer_trust', 'mcp_server']),
    )
    const tools: string[] = m.endpoints.mcp.mcp_tools
    expect(tools).toEqual(expect.arrayContaining(['get_store_configuration', 'patch_store_configuration']))
    expect(tools.length).toBe(11)
    expect(m.endpoints.seller_configuration).toBeTruthy()
  })

  test('/agent briefing uses the real MCP URL and no stale endpoints', async ({ request }) => {
    const res = await request.get('/agent')
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).toContain('/api/ucp/mcp')
    expect(html).toContain('/api/ucp/catalog')
    // The bugs this epic fixed must never come back.
    expect(html).not.toContain('/api/ucp/listings')
    expect(html).not.toContain('/api/mcp')
  })

  test('.well-known/ucp resolves to the manifest', async ({ request }) => {
    const res = await request.get('/.well-known/ucp')
    expect(res.ok()).toBeTruthy()
    const m = await res.json()
    expect(m.name).toBe('miyagisanchez-ucp')
  })

  test('MCP tools/list lists seller tools; the seller tool rejects calls without a token', async ({ request }) => {
    const list = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(list.ok()).toBeTruthy()
    const names: string[] = (await list.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_store_configuration', 'patch_store_configuration']))

    const call = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_store_configuration', arguments: {} } },
    })
    const text: string = (await call.json()).result.content[0].text
    expect(text).toContain('Unauthorized')
  })
})
