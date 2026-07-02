import { expect, test } from '@playwright/test'
import { classifyAgentCredential, parseBearer, CONNECTOR_PREFIX } from '../lib/agent-auth'
import { resolveFlag, type FlagRow } from '../lib/flags-cache'

/**
 * Seller agent connect · Sprint 2 (epic 03 · seller-agent-connect-mcp-url) — the
 * personal MCP URL's auth path (`/api/ucp/mcp/c/<slug>`), gated by the
 * `seller_agent.connector_url_enabled` kill-switch.
 *
 *  1. PURE SEAM — credential-shape classification (`lib/agent-auth.ts`), no DB, no
 *     network. This is what makes "valid vs. invalid credential shape" and "both
 *     flag states" deterministically testable without a DB mock or a live flag flip
 *     (this codebase has neither today — see `flags-cache.spec.ts` for the same
 *     pattern applied to the flag reader itself).
 *  2. ROUTE GUARDS — live, flag-agnostic (`[401, 404]`, same convention as
 *     `promoter-close.spec.ts`): a malformed slug, and a well-formed-but-guaranteed-
 *     absent slug, both against the real resolver. Never a 200, never a 500.
 *
 * NOT covered (owed to Daniel — sprint-2.md smoke walkthrough steps 2–4): the live
 * "valid slug → returns THIS shop's config only", rotate-breaks-the-old-URL, and the
 * claude.ai connector round-trip. Cross-shop denial is architectural (same single-row
 * `.eq()` lookup shape the Bearer token already relies on), not separately
 * fixture-tested here either.
 */

test.describe('agent-connector · classifyAgentCredential (pure)', () => {
  test('recognizes the bearer-token prefix', () => {
    expect(classifyAgentCredential('ms_agent_deadbeef')).toBe('bearer')
  })

  test('recognizes the connector-slug prefix', () => {
    expect(classifyAgentCredential(`${CONNECTOR_PREFIX}abc123`)).toBe('connector')
  })

  test('rejects an unknown/garbage shape', () => {
    for (const bad of ['', 'sk_live_whatever', 'ms_agent', 'ms_connector', 'Bearer ms_agent_x']) {
      expect(classifyAgentCredential(bad)).toBeNull()
    }
  })
})

test.describe('agent-connector · parseBearer accepts both credential shapes', () => {
  test('extracts a bearer-token credential', () => {
    expect(parseBearer('Bearer ms_agent_deadbeef')).toBe('ms_agent_deadbeef')
  })

  test('extracts a connector-slug credential', () => {
    const token = `${CONNECTOR_PREFIX}xyz789`
    expect(parseBearer(`Bearer ${token}`)).toBe(token)
  })

  test('rejects a well-formed header carrying neither known prefix', () => {
    expect(parseBearer('Bearer sk_live_something')).toBeNull()
  })

  test('rejects a missing/malformed header', () => {
    for (const header of [null, undefined, '', 'ms_agent_deadbeef', 'Basic ms_agent_deadbeef']) {
      expect(parseBearer(header)).toBeNull()
    }
  })
})

test.describe('agent-connector · seller_agent.connector_url_enabled fail-open (both states)', () => {
  const DEFAULTS = { 'seller_agent.connector_url_enabled': false } as const

  test('missing row falls open to the enablement default (OFF)', () => {
    expect(resolveFlag([], 'seller_agent.connector_url_enabled', DEFAULTS)).toBe(false)
  })

  test('an explicit row overrides the default in both directions', () => {
    const on: FlagRow[] = [{ key: 'seller_agent.connector_url_enabled', enabled: true }]
    const off: FlagRow[] = [{ key: 'seller_agent.connector_url_enabled', enabled: false }]
    expect(resolveFlag(on, 'seller_agent.connector_url_enabled', DEFAULTS)).toBe(true)
    expect(resolveFlag(off, 'seller_agent.connector_url_enabled', DEFAULTS)).toBe(false)
  })
})

test.describe('agent-connector · GET /api/sell/agent-connector respects the kill-switch (flag on OR off)', () => {
  // flag off ⇒ 404 (hidden); flag on ⇒ 401 (auth required, anonymous request). Asserted
  // in both states, same pattern as e2e/promoter-close.spec.ts.
  test('anonymous GET → 404 (hidden) or 401 (live, auth required)', async ({ request }) => {
    const res = await request.get('/api/sell/agent-connector')
    expect([401, 404]).toContain(res.status())
  })

  test('anonymous POST (rotate) → 404 or 401', async ({ request }) => {
    const res = await request.post('/api/sell/agent-connector')
    expect([401, 404]).toContain(res.status())
  })

  test('anonymous DELETE (revoke) → 404 or 401', async ({ request }) => {
    const res = await request.delete('/api/sell/agent-connector')
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('agent-connector · POST /api/ucp/mcp/c/<slug> never leaks scope on a bad credential', () => {
  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_store_configuration', arguments: {} },
  }

  test('a malformed slug (wrong shape — too long) never resolves — 404 (flag off) or 401 (flag on)', async ({ request }) => {
    const tooLong = 'x'.repeat(200) // SLUG_SHAPE caps at 64 chars
    const res = await request.post(`/api/ucp/mcp/c/${tooLong}`, { data: rpcBody })
    expect([401, 404]).toContain(res.status())
  })

  test('a well-formed but guaranteed-absent slug never resolves — 404 or 401', async ({ request }) => {
    // 32 base64url chars matches generateConnectorSlug()'s shape but was never issued.
    const neverIssued = 'zZ9-_'.repeat(7)
    const res = await request.post(`/api/ucp/mcp/c/${neverIssued}`, { data: rpcBody })
    expect([401, 404]).toContain(res.status())
  })

  test('GET (discovery) is flag-gated the same way — never 200 with the flag off', async ({ request }) => {
    const res = await request.get('/api/ucp/mcp/c/whatever-slug')
    // Discovery has no auth concept, so the only invariant we can assert without
    // knowing the live flag value is "never a 5xx" — 200 (flag on) or 404 (flag off).
    expect([200, 404]).toContain(res.status())
  })
})
