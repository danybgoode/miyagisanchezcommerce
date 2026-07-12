import { test, expect } from '@playwright/test'
import { validateListingTitle } from '../lib/collection-derive'

/**
 * Seller listing tools (Seller Agent Operations · Sprint 2).
 * Guards the auth boundary — listing-management tools must reject any call
 * without a valid per-shop token. Read-only; never mutates a listing.
 */

/**
 * mcp-parity-core S1.5 — `update_listing` documented "New title (max 100
 * chars)" but enforced nothing, so an oversized/empty title silently fell
 * through to the backend's `.slice(0,100)` truncation instead of being
 * rejected. `validateListingTitle` (`lib/collection-derive.ts`) is the fix,
 * the exact function `handleUpdateListing` now calls before the backend
 * write — tested directly, pure, same shape as `validateCollectionName`'s
 * own tests in `mcp-create-collection.spec.ts` (no real token needed).
 */
test.describe('update_listing — title validation (pure)', () => {
  test('rejects an empty or whitespace-only title', () => {
    expect(validateListingTitle('').ok).toBe(false)
    expect(validateListingTitle('   ').ok).toBe(false)
  })

  test('rejects a title over 100 characters', () => {
    const r = validateListingTitle('x'.repeat(101))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('demasiado largo')
  })

  test('accepts and trims a valid title, including a short one', () => {
    const r = validateListingTitle('  Hi  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.title).toBe('Hi')
  })

  test('accepts a title at exactly the 100-char boundary', () => {
    const r = validateListingTitle('x'.repeat(100))
    expect(r.ok).toBe(true)
  })
})
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
