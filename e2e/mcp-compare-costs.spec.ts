import { test, expect } from '@playwright/test'
import { computeShopifyCost, computeMiyagiCost } from '../lib/cost-comparator'
import { shopifyRatesFromDataset, miyagiRatesFromDataset } from '../lib/cost-comparator-dataset'
import type { ComparatorDataset } from '../lib/cost-comparator-dataset'
// Import attribute required for the same reason e2e/comparador.spec.ts needs it —
// see lib/cost-comparator-dataset.ts's file header.
import baselineDataset from '../lib/cost-comparator-dataset.json' with { type: 'json' }

const baseline = baselineDataset as ComparatorDataset

/**
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.3) — the
 * MCP `compare_costs` tool. sprint-2.md's spec: "tool output equals lib output for
 * a fixed input; responses carry verified date + sources." No auth, no flag (see
 * the tool's own handler comment for why — same shape as about_miyagi/
 * get_checkout_options/search_listings, the mcp.*.enabled flags only gate the
 * newer SELLER write tools).
 */

test.describe('compare_costs · discovery', () => {
  test('tools/list advertises it as a buyer tool (no shop_slug injected)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === 'compare_costs')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema?.required).toEqual(['platform', 'volume_monthly', 'aov_mxn'])
    // Buyer tool — never gets the seller-only shop_slug property injected.
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).not.toContain('shop_slug')
  })
})

test.describe('compare_costs · tool output equals the pure lib for a fixed input', () => {
  test('shopify/basico, 100 ventas/mes @ $500 — monthly + annual totals match computeShopifyCost exactly', async ({ request }) => {
    const volumeMonthly = 100
    const aovMxn = 500
    const call = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'compare_costs', arguments: { platform: 'shopify', shopify_tier: 'basico', volume_monthly: volumeMonthly, aov_mxn: aovMxn } },
      },
    })
    expect(call.ok()).toBeTruthy()
    const body = await call.json()
    expect(body.result.isError).toBeFalsy()

    const jsonBlock = body.result.content.find((c: { type: string; text: string }) => c.text.trim().startsWith('{'))
    const result = JSON.parse(jsonBlock.text)

    const expectedCompetitor = computeShopifyCost({ volumeMonthly, aovMxn }, 'basico', shopifyRatesFromDataset(baseline))
    const expectedMiyagi = computeMiyagiCost({ volumeMonthly, aovMxn }, { subdomain: false, customDomain: false, mlSync: false }, miyagiRatesFromDataset(baseline))

    expect(result.competitor.monthly_total_mxn).toBe(expectedCompetitor.monthlyTotalMxn)
    expect(result.competitor.annual_total_mxn).toBe(expectedCompetitor.annualTotalMxn)
    expect(result.miyagi.monthly_total_mxn).toBe(expectedMiyagi.monthlyTotalMxn)
    expect(result.miyagi.annual_total_mxn).toBe(expectedMiyagi.annualTotalMxn)
    expect(result.savings.monthly_mxn).toBe(Math.round((expectedCompetitor.monthlyTotalMxn - expectedMiyagi.monthlyTotalMxn) * 100) / 100)

    // Verified date + sources, per the spec.
    expect(result.verified_at).toBe(baseline.generatedAt)
    expect(Array.isArray(result.sources)).toBe(true)
    expect(result.sources.length).toBeGreaterThan(0)
    for (const s of result.sources) {
      expect(typeof s.source).toBe('string')
      expect(s.source.trim()).not.toBe('')
      expect(typeof s.verified_at).toBe('string')
    }
  })

  test('a Miyagi SKU toggle (subdomain) changes the Miyagi total exactly like the lib', async ({ request }) => {
    const volumeMonthly = 20
    const aovMxn = 300
    const call = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'compare_costs', arguments: { platform: 'woocommerce', volume_monthly: volumeMonthly, aov_mxn: aovMxn, miyagi_subdomain: true } },
      },
    })
    const result = JSON.parse((await call.json()).result.content.find((c: { text: string }) => c.text.trim().startsWith('{')).text)
    const expectedMiyagi = computeMiyagiCost({ volumeMonthly, aovMxn }, { subdomain: true, customDomain: false, mlSync: false }, miyagiRatesFromDataset(baseline))
    expect(result.miyagi.monthly_total_mxn).toBe(expectedMiyagi.monthlyTotalMxn)
  })

  test('an invalid platform is refused cleanly, never a 500', async ({ request }) => {
    const call = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'compare_costs', arguments: { platform: 'amazon', volume_monthly: 10, aov_mxn: 100 } },
      },
    })
    expect(call.status()).toBeLessThan(500)
    const body = await call.json()
    expect(body.result.isError).toBe(true)
  })
})
