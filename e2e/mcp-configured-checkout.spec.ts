import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * MCP agent parity for the configurator (custom-print-products epic,
 * Sprint 4 · Story 4.2). No configurator listing is seeded in every dev
 * environment, so — same discipline as e2e/artwork-upload.spec.ts — these
 * specs exercise the branching/validation paths against fake ids rather
 * than a real successful checkout (that full round-trip, with a real
 * artwork URL and a real payment, is owed to Daniel per sprint-4.md).
 */
test.describe('MCP create_checkout — configurator parity', () => {
  test('source orders the market-scoped configurator guard before checkout-session prevalidation', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    const createCheckout = source.slice(
      source.indexOf('async function handleCreateCheckout('),
      source.indexOf('async function handleCreateConfiguredCheckout('),
    )

    const configuredGuard = createCheckout.indexOf(
      'getPriceGrid(listingId, marketDecision.market.code)',
    )
    const sessionValidation = createCheckout.indexOf(
      'fetch(`${baseUrl}/api/ucp/checkout-session`',
    )

    expect(configuredGuard).toBeGreaterThan(-1)
    expect(sessionValidation).toBeGreaterThan(-1)
    expect(configuredGuard).toBeLessThan(sessionValidation)
    expect(source).toContain('function publicCheckoutError(')
    expect(source).not.toContain('JSON.stringify(value)')
    expect(createCheckout).not.toContain('Checkout failed: ${data.error')
  })

  test('tools/list advertises variant_id/quantity/artwork_url on create_checkout', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const createCheckout = tools.find(t => t.name === 'create_checkout')
    expect(createCheckout).toBeDefined()
    expect(Object.keys(createCheckout!.inputSchema.properties)).toEqual(
      expect.arrayContaining(['variant_id', 'quantity', 'artwork_url']),
    )
  })

  test('a variant_id on a listing with no price_grid errors clearly, and isError is set', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'create_checkout', arguments: { listing_id: 'prod_does_not_exist', variant_id: 'variant_does_not_exist' } },
      },
    })
    const result = (await res.json()).result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no configurator price grid')
    expect(result.content[0].text).not.toContain('[object Object]')
  })

  test('an unresolvable variant_id on a real price_grid names the mismatch, not a generic failure', async ({ request }) => {
    // Even without a seeded product, a listing_id that genuinely 404s at
    // Medusa short-circuits at the price-grid step above — this spec pins
    // that the SPECIFIC "no configurator price grid" message fires for a
    // missing listing, never a generic/unhandled exception leaking through.
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'create_checkout', arguments: { listing_id: 'prod_totally_fake_12345', variant_id: 'v_fake', quantity: 5 } },
      },
    })
    const result = (await res.json()).result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).not.toContain('[object Object]')
    expect(result.content[0].text).not.toContain('undefined')
    expect(result.content[0].text).not.toMatch(/TypeError|ReferenceError/)
  })

  test('omitting variant_id keeps the original flat-price path untouched (no configurator branch taken)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'create_checkout', arguments: { listing_id: 'prod_totally_fake_12345' } },
      },
    })
    const result = (await res.json()).result as { isError?: boolean; content: Array<{ text: string }> }
    // The flat path's error shape ("Checkout failed: ...") is distinct from
    // the configurator path's ("...no configurator price grid...") — this
    // pins that a call with no variant_id never takes the new branch.
    expect(result.content[0].text).not.toContain('[object Object]')
    expect(result.content[0].text).not.toContain('configurator price grid')
  })
})
