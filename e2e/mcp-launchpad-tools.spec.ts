import { test, expect } from '@playwright/test'

/**
 * mcp-parity-core S1 — the bookshop launchpad had ZERO MCP write tools before
 * this sprint (campaigns + manuscript review were portal-UI-only), which
 * directly blocked panfleto-premium-shop S3. This spec covers all 8 tools:
 * the 2 previously-uncovered read tools (list_manuscript_submissions,
 * list_launchpad_campaigns — S1.6) plus the 6 new write tools (S1.1/S1.2).
 *
 * Mirrors `mcp-order-read.spec.ts`'s pattern: no `ms_agent_…` test-token
 * fixture exists yet for a full live round-trip (a real seeded shop with
 * launchpad.enabled + real submissions/campaigns) — that's the same owed gap
 * `agent-connector.spec.ts`/`mcp-order-read.spec.ts`/`mcp-create-collection.spec.ts`
 * already note. Auth (no-token / garbage-token) is testable past the
 * `launchpad.enabled` check (resolveAgentShop rejects first, same order every
 * handler uses), so that's the boundary these tests actually exercise.
 */

const LAUNCHPAD_TOOLS = [
  'list_manuscript_submissions',
  'review_submission',
  'publish_submission',
  'list_launchpad_campaigns',
  'create_campaign',
  'update_campaign',
  'activate_campaign',
  'cancel_campaign',
] as const

test.describe('launchpad MCP tools — schema + auth boundary', () => {
  for (const name of LAUNCHPAD_TOOLS) {
    test(`${name}: tools/list advertises it`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
      const tools: Array<{ name: string }> = (await res.json()).result.tools
      expect(tools.some((t) => t.name === name)).toBe(true)
    })

    test(`${name}: rejects a call with no Bearer token — never leaks scope, never a 500`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { submission_id: 'x', campaign_id: 'x', status: 'in_review' } } },
      })
      expect(res.status()).toBeLessThan(500)
      const body = await res.json()
      const text: string = body.result.content[0].text
      expect(text).toContain('Unauthorized')
    })

    test(`${name}: rejects a call with a garbage Bearer token the same way`, async ({ request }) => {
      const res = await request.post('/api/ucp/mcp', {
        data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: { submission_id: 'x', campaign_id: 'x', status: 'in_review' } } },
        headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
      })
      expect(res.status()).toBeLessThan(500)
      const body = await res.json()
      const text: string = body.result.content[0].text
      expect(text).toContain('Unauthorized')
    })
  }
})

test.describe('create_campaign / update_campaign — required-field schema shape', () => {
  test('create_campaign requires only title; the rest are optional at draft time', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === 'create_campaign')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema?.required).toEqual(['title'])
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['title', 'reward_product_id', 'work_product_ids', 'vote_threshold', 'ends_at', 'reward_percent']),
    )
  })

  test('update_campaign and activate_campaign/cancel_campaign require campaign_id', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[] } }> = (await res.json()).result.tools
    for (const name of ['update_campaign', 'activate_campaign', 'cancel_campaign']) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, `${name} should be declared`).toBeDefined()
      expect(tool!.inputSchema?.required).toEqual(['campaign_id'])
    }
  })

  test('review_submission requires submission_id and status; publish_submission requires only submission_id', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[] } }> = (await res.json()).result.tools
    const review = tools.find((t) => t.name === 'review_submission')
    expect(review!.inputSchema?.required).toEqual(['submission_id', 'status'])
    const publish = tools.find((t) => t.name === 'publish_submission')
    expect(publish!.inputSchema?.required).toEqual(['submission_id'])
  })
})

test.describe('launchpad manifest wiring', () => {
  test('GET /api/ucp/manifest lists every launchpad tool in the seller_launchpad endpoint AND the aggregate mcp tool list', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    const manifest = await res.json()
    for (const name of LAUNCHPAD_TOOLS) {
      expect(manifest.endpoints.seller_launchpad.mcp_tools, `seller_launchpad should list ${name}`).toContain(name)
      expect(manifest.endpoints.mcp.mcp_tools, `aggregate mcp tool list should include ${name}`).toContain(name)
    }
    expect(manifest.capabilities).toContain('seller_launchpad')
  })
})
