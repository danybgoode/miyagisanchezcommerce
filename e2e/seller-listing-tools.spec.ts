import { test, expect } from '@playwright/test'

/**
 * Seller listing tools (Seller Agent Operations · Sprint 2).
 * Guards the auth boundary — listing-management tools must reject any call
 * without a valid per-shop token. Read-only; never mutates a listing.
 */
test.describe('Seller listing MCP tools', () => {
  test('tools/list advertises the listing tools', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const names: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_my_listings', 'update_listing', 'set_listing_status']))
  })

  for (const [name, args] of [
    ['list_my_listings', {}],
    ['update_listing', { product_id: 'x', title: 'y' }],
    ['set_listing_status', { product_id: 'x', status: 'paused' }],
  ] as const) {
    test(`${name} rejects calls without a shop token`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
      })
      const result = (await res.json()).result
      expect(result.content[0].text).toContain('Unauthorized')
      // isError must survive the tools/call dispatch — an agent branching on
      // isError (not prose) needs this, not just "Unauthorized" in the text.
      expect(result.isError).toBe(true)
    })
  }
})
