import { test, expect } from '@playwright/test'

/**
 * mcp-parity-core S3 — the two money-adjacent listing tools:
 * `delete_listing` (soft-delete an owned listing) and `apply_price`
 * (one-click price apply through the Profit Analyzer pipeline).
 *
 * Mirrors `mcp-launchpad-tools.spec.ts`'s boundary pattern: no `ms_agent_…`
 * test-token fixture exists yet for a live authed round-trip (same owed gap
 * that spec notes), so the testable boundary is discovery/schema + the auth
 * rejection — `resolveAgentShop` rejects before each tool's flag check
 * (auth → flag, the order every seller handler uses); the flag-OFF refusal
 * and the real mutations are Daniel's smoke walkthrough (sprint-3.md).
 */

const TOOLS = ['delete_listing', 'apply_price'] as const

test.describe('S3 money-adjacent tools — discovery + schema', () => {
  test('tools/list advertises both with the right required fields', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools

    const del = tools.find((t) => t.name === 'delete_listing')
    expect(del).toBeDefined()
    expect(del!.inputSchema?.required).toEqual(['product_id'])

    const apply = tools.find((t) => t.name === 'apply_price')
    expect(apply).toBeDefined()
    expect(apply!.inputSchema?.required).toEqual(['product_id', 'variant_id', 'new_price_cents'])
    expect(Object.keys(apply!.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['product_id', 'variant_id', 'new_price_cents', 'target_margin_pct']),
    )
  })

  test('delete_listing description states the soft-delete/order-history semantics', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; description?: string }> = (await res.json()).result.tools
    const del = tools.find((t) => t.name === 'delete_listing')
    // The sprint doc originally assumed an order-linked refusal guard; the
    // real system soft-deletes (order history intact) with no guard — the
    // tool's own description is where an agent learns that contract.
    expect(del?.description).toContain('soft-delete')
    expect(del?.description).toContain('order history')
  })
})

test.describe('S3 money-adjacent tools — auth boundary', () => {
  for (const name of TOOLS) {
    test(`${name}: rejects a call with no Bearer token — never leaks scope, never a 500`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: {
          jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name, arguments: { product_id: 'prod_x', variant_id: 'var_x', new_price_cents: 1000 } },
        },
      })
      expect(res.status()).toBeLessThan(500)
      const body = await res.json()
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Unauthorized')
    })

    test(`${name}: rejects a garbage Bearer token the same way`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: {
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name, arguments: { product_id: 'prod_x', variant_id: 'var_x', new_price_cents: 1000 } },
        },
        headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
      })
      expect(res.status()).toBeLessThan(500)
      const body = await res.json()
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Unauthorized')
    })
  }
})
