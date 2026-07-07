import { test, expect } from '@playwright/test'

/**
 * `tools/call`'s switch statement in `app/api/ucp/mcp/route.ts` used to drop
 * `isError` for most tools — `return { content: (await handleX(args)).content }`
 * discards it even when the handler explicitly returned `isError: true`. Only
 * the domain/subdomain entitlement tools + `list_orders` propagated it via
 * `{ content: r.content, ...(r.isError ? { isError: true } : {}) }`. An agent
 * that branches on `result.isError` (rather than parsing prose out of
 * `content[0].text`) never saw the failure on every other tool.
 *
 * This spec exercises one guaranteed-error call per newly-fixed tool and
 * asserts `result.isError === true`, not just that the error text is present
 * (existing specs already covered the text; none checked `isError`).
 *
 * `search_listings` is deliberately NOT covered here: its only `isError` paths
 * are a non-2xx or thrown fetch against the live Medusa store API — there is
 * no argument-only way to force that deterministically without mocking (which
 * this harness doesn't do), so it's left as a known coverage gap rather than a
 * flaky live-dependency test.
 */

async function callTool(request: import('@playwright/test').APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/ucp/mcp', {
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  expect(res.status()).toBeLessThan(500)
  return (await res.json()).result as { content: Array<{ type: string; text: string }>; isError?: boolean }
}

test.describe('MCP tools/call — isError propagation (guaranteed-error cases)', () => {
  test('get_listing: unknown id → isError', async ({ request }) => {
    const result = await callTool(request, 'get_listing', { id: 'definitely-not-a-real-listing-id' })
    expect(result.isError).toBe(true)
  })

  test('get_shop: unknown slug → isError', async ({ request }) => {
    const result = await callTool(request, 'get_shop', { shop_slug: 'definitely-not-a-real-shop-slug' })
    expect(result.isError).toBe(true)
  })

  test('get_checkout_options: missing listing_id → isError', async ({ request }) => {
    const result = await callTool(request, 'get_checkout_options', {})
    expect(result.content[0].text).toContain('listing_id')
    expect(result.isError).toBe(true)
  })

  test('create_checkout: unknown listing_id → isError', async ({ request }) => {
    const result = await callTool(request, 'create_checkout', { listing_id: 'definitely-not-a-real-listing-id' })
    expect(result.isError).toBe(true)
  })

  test('get_support_options: missing embed_key → isError', async ({ request }) => {
    const result = await callTool(request, 'get_support_options', {})
    expect(result.content[0].text).toContain('embed_key')
    expect(result.isError).toBe(true)
  })

  test('create_support_checkout: missing required fields → isError', async ({ request }) => {
    const result = await callTool(request, 'create_support_checkout', {})
    expect(result.content[0].text).toContain('embed_key')
    expect(result.isError).toBe(true)
  })

  test('make_offer: missing required fields → isError', async ({ request }) => {
    const result = await callTool(request, 'make_offer', {})
    expect(result.content[0].text).toContain('Missing required fields')
    expect(result.isError).toBe(true)
  })

  test('check_availability: missing listing_id → isError', async ({ request }) => {
    const result = await callTool(request, 'check_availability', {})
    expect(result.content[0].text).toContain('listing_id is required')
    expect(result.isError).toBe(true)
  })

  test('book_appointment: missing required fields → isError', async ({ request }) => {
    const result = await callTool(request, 'book_appointment', {})
    expect(result.content[0].text).toContain('Required:')
    expect(result.isError).toBe(true)
  })

  test('get_buyer_trust: missing identifier → isError', async ({ request }) => {
    const result = await callTool(request, 'get_buyer_trust', {})
    expect(result.content[0].text).toContain('identifier is required')
    expect(result.isError).toBe(true)
  })

  test('get_store_configuration: no shop token → isError', async ({ request }) => {
    const result = await callTool(request, 'get_store_configuration', {})
    expect(result.content[0].text).toContain('Unauthorized')
    expect(result.isError).toBe(true)
  })

  test('patch_store_configuration: no shop token → isError', async ({ request }) => {
    const result = await callTool(request, 'patch_store_configuration', { configuration: { profile: { theme_preset: 'pizarra' } } })
    expect(result.content[0].text).toContain('Unauthorized')
    expect(result.isError).toBe(true)
  })
})
