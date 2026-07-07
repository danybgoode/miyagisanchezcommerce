import { test, expect } from '@playwright/test'

/**
 * Seller offer tools (Seller Agent Operations · Sprint 1).
 * Guards the auth boundary — the money-touching seller tools must reject any
 * call without a valid per-shop token. Read-only; never mutates an offer.
 */
test.describe('Seller offer MCP tools', () => {
  test('tools/list advertises list_offers and respond_to_offer', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.ok()).toBeTruthy()
    const names: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_offers', 'respond_to_offer']))
  })

  test('list_offers rejects calls without a shop token', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_offers', arguments: {} } },
    })
    const result = (await res.json()).result
    expect(result.content[0].text).toContain('Unauthorized')
    expect(result.isError).toBe(true)
  })

  test('respond_to_offer rejects calls without a shop token', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'respond_to_offer', arguments: { offer_id: 'x', action: 'decline' } } },
    })
    const result = (await res.json()).result
    expect(result.content[0].text).toContain('Unauthorized')
    expect(result.isError).toBe(true)
  })
})
