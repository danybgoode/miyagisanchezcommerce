import { test, expect } from '@playwright/test'
import { validateFeedbackInput, FEEDBACK_CATEGORIES } from '../lib/feedback'

/**
 * miyagi-partners-mcp · Sprint 3 — `send_feedback` MCP tool. Mirrors
 * `mcp-create-collection.spec.ts`'s shape for a new seller/partner-scoped
 * mutation tool: no `ms_agent_…`/`ms_partner_…` test-token fixture exists yet
 * for a full live round-trip (the same standing gap `agent-connector.spec.ts`
 * and `partner-auth.spec.ts` already note) — the actual per-credential-shape
 * author-identity resolution (seller → author_kind='seller', partner →
 * author_kind='partner') is the Sprint-3 Daniel smoke walkthrough. What IS
 * deterministically testable without a fixture: input validation (extracted
 * pure into `lib/feedback.ts`, the exact function `handleSendFeedback` calls),
 * the tool's schema/manifest wiring, and the auth boundary (no-token /
 * garbage-token — never a 500, never leaked scope). Dispatch-case coverage is
 * `mcp-tool-dispatch-parity.spec.ts` (every declared tool has a dispatch case
 * + is advertised in `MCP_TOOL_NAMES`).
 */

test.describe('send_feedback — input validation (pure)', () => {
  test('rejects an invalid or missing category', () => {
    expect(validateFeedbackInput({ category: 'not-a-real-category', message: 'hello there' }).ok).toBe(false)
    expect(validateFeedbackInput({ message: 'hello there' }).ok).toBe(false)
    expect(validateFeedbackInput(undefined).ok).toBe(false)
  })

  test('accepts every declared category', () => {
    for (const category of FEEDBACK_CATEGORIES) {
      const r = validateFeedbackInput({ category, message: 'a valid message body' })
      expect(r.ok, category).toBe(true)
    }
  })

  test('rejects a missing/too-short message', () => {
    expect(validateFeedbackInput({ category: 'bug' }).ok).toBe(false)
    expect(validateFeedbackInput({ category: 'bug', message: '' }).ok).toBe(false)
    expect(validateFeedbackInput({ category: 'bug', message: '   ' }).ok).toBe(false)
    expect(validateFeedbackInput({ category: 'bug', message: 'hi' }).ok).toBe(false) // under 5 chars
  })

  test('rejects an over-cap message (>2000 chars)', () => {
    const r = validateFeedbackInput({ category: 'bug', message: 'x'.repeat(2001) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('demasiado largo')
  })

  test('trims the message and accepts a valid one at the boundary', () => {
    const r = validateFeedbackInput({ category: 'feature', message: '  a message with padding  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.message).toBe('a message with padding')
  })

  test('tool_name is optional; a non-string tool_name is rejected', () => {
    const withTool = validateFeedbackInput({ category: 'mcp-tool', message: 'the thing is broken', tool_name: 'get_listing' })
    expect(withTool.ok).toBe(true)
    if (withTool.ok) expect(withTool.toolName).toBe('get_listing')

    const withoutTool = validateFeedbackInput({ category: 'mcp-tool', message: 'the thing is broken' })
    expect(withoutTool.ok).toBe(true)
    if (withoutTool.ok) expect(withoutTool.toolName).toBeNull()

    const badTool = validateFeedbackInput({ category: 'mcp-tool', message: 'the thing is broken', tool_name: 123 })
    expect(badTool.ok).toBe(false)
  })
})

test.describe('send_feedback MCP tool', () => {
  test('tools/list advertises send_feedback with category + message required', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const tool = tools.find((t) => t.name === 'send_feedback')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema?.required).toEqual(expect.arrayContaining(['category', 'message']))
    expect(Object.keys(tool!.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['category', 'message', 'tool_name', 'shop_slug']),
    )
  })

  test('rejects a call with no Bearer token — never leaks scope, never a 500', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'send_feedback', arguments: { category: 'bug', message: 'something is broken' } } },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(body.result.isError).toBe(true)
    expect(text).toContain('Unauthorized')
  })

  test('rejects a call with a garbage Bearer token the same way', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_feedback', arguments: { category: 'bug', message: 'something is broken' } } },
      headers: { Authorization: 'Bearer ms_agent_definitely-not-real' },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    const text: string = body.result.content[0].text
    expect(body.result.isError).toBe(true)
    expect(text).toContain('Unauthorized')
  })

  test('a never-issued partner token is rejected the same way (partner shape reaches the same auth boundary)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_feedback', arguments: { category: 'bug', message: 'something is broken' } } },
      headers: { Authorization: `Bearer ms_partner_${'0'.repeat(64)}` },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

test.describe('send_feedback manifest wiring', () => {
  test('GET /api/ucp/manifest lists send_feedback in the aggregate mcp tool list', async ({ request }) => {
    const res = await request.get('/api/ucp/manifest')
    const manifest = await res.json()
    expect(manifest.endpoints.mcp.mcp_tools).toContain('send_feedback')
  })
})
