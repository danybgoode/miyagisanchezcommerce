import { test, expect } from '@playwright/test'

/**
 * Seller listing creation tool (Seller Agent Operations · Sprint 3).
 * Guards the auth boundary — create_listing must reject any call without a valid
 * per-shop token. Read-only / no-token: never creates a listing.
 */
test.describe('Seller listing creation MCP tool', () => {
  test('tools/list advertises create_listing', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const names: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('create_listing')
  })

  test('create_listing rejects calls without a shop token', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'create_listing', arguments: { title: 'Anuncio de prueba', category: 'otros' } },
      },
    })
    const text: string = (await res.json()).result.content[0].text
    expect(text).toContain('Unauthorized')
  })
})
