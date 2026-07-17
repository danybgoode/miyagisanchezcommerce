import { expect, test } from '@playwright/test'
import { classifyAgentCredential, parseBearer, PARTNER_PREFIX, generatePartnerToken, hashAgentToken } from '../lib/agent-auth'
import { PARTNER_READ_TOOLS } from '../lib/partner-tools'
import { resolveFlag, type FlagRow } from '../lib/flags-cache'

/**
 * Miyagi Partners · Sprint 1 — the ms_partner_ credential's auth boundary
 * (miyagi-partners-mcp, flag `partners.mcp_enabled`, dark-launch).
 *
 * Same coverage shape as `agent-connector.spec.ts` (the seller connector's
 * spec): pure credential-shape classification + live route guards. The
 * grant/role/revoke paths (cross-shop denial, viewer-write denial,
 * revoke-then-call) are DB-backed per call and — per the standing
 * `ms_agent_` fixture gap every seller-tool spec notes — only exercisable
 * with a real credential: they're the Sprint-1 Daniel smoke walkthrough,
 * steps 2–8. What IS deterministically testable without a fixture:
 *   1. the third prefix classifies/parses (pure),
 *   2. token mint/hash discipline (pure),
 *   3. the read-tool allow-list shape (pure),
 *   4. flag fail-open default is OFF (pure),
 *   5. live: a partner-shaped token on /api/ucp/mcp is rejected exactly like
 *      a garbage token (flag off today ⇒ indistinguishable — the S1.1
 *      acceptance), and /api/ucp/mcp/p/<slug> never leaks (404 flag-off /
 *      401 unknown-slug, never 200/500).
 */

test.describe('partner-auth · classifyAgentCredential gains the third prefix (pure)', () => {
  test('recognizes the partner prefix', () => {
    expect(classifyAgentCredential(`${PARTNER_PREFIX}deadbeef`)).toBe('partner')
  })

  test('still recognizes the two seller shapes (parity untouched)', () => {
    expect(classifyAgentCredential('ms_agent_deadbeef')).toBe('bearer')
    expect(classifyAgentCredential('ms_connector_abc123')).toBe('connector')
  })

  test('rejects garbage shapes', () => {
    for (const bad of ['', 'ms_partner', 'sk_live_x', 'partner_ms_x']) {
      expect(classifyAgentCredential(bad)).toBeNull()
    }
  })
})

test.describe('partner-auth · parseBearer accepts the partner shape (pure)', () => {
  test('extracts a partner credential', () => {
    const token = `${PARTNER_PREFIX}cafebabe`
    expect(parseBearer(`Bearer ${token}`)).toBe(token)
  })

  test('still rejects unknown prefixes', () => {
    expect(parseBearer('Bearer sk_live_something')).toBeNull()
  })
})

test.describe('partner-auth · token mint discipline (pure)', () => {
  test('generatePartnerToken emits the prefix + 64 hex chars, hash = SHA-256 of the full token', () => {
    const { token, hash } = generatePartnerToken()
    expect(token.startsWith(PARTNER_PREFIX)).toBe(true)
    expect(token.slice(PARTNER_PREFIX.length)).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashAgentToken(token))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

test.describe('partner-auth · viewer read-tool allow-list (pure)', () => {
  test('read tools are reads; the money/mutation tools are NOT in the list', () => {
    expect(PARTNER_READ_TOOLS.has('list_my_listings')).toBe(true)
    expect(PARTNER_READ_TOOLS.has('get_store_configuration')).toBe(true)
    for (const write of ['patch_store_configuration', 'delete_listing', 'apply_price', 'set_shop_slug', 'respond_to_offer', 'create_listing', 'start_domain_subscription']) {
      expect(PARTNER_READ_TOOLS.has(write), `${write} must NOT be viewer-callable`).toBe(false)
    }
  })
})

test.describe('partner-auth · partners.mcp_enabled fail-open default (pure)', () => {
  const DEFAULTS = { 'partners.mcp_enabled': false } as const

  test('missing row falls open to OFF (dark-launch polarity)', () => {
    expect(resolveFlag([], 'partners.mcp_enabled', DEFAULTS)).toBe(false)
  })

  test('an explicit row overrides in both directions', () => {
    const on: FlagRow[] = [{ key: 'partners.mcp_enabled', enabled: true }]
    const off: FlagRow[] = [{ key: 'partners.mcp_enabled', enabled: false }]
    expect(resolveFlag(on, 'partners.mcp_enabled', DEFAULTS)).toBe(true)
    expect(resolveFlag(off, 'partners.mcp_enabled', DEFAULTS)).toBe(false)
  })
})

test.describe('partner-auth · live boundary — partner token on the main MCP route', () => {
  test('a never-issued partner token is rejected exactly like a garbage token (never 500, never scope)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_my_listings', arguments: {} } },
      headers: { Authorization: `Bearer ${PARTNER_PREFIX}${'0'.repeat(64)}` },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Unauthorized')
  })

  test('a partner token with shop_slug pointing at a real shop still resolves nothing (flag-off/no-grant)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_store_configuration', arguments: { shop_slug: 'any-shop' } } },
      headers: { Authorization: `Bearer ${PARTNER_PREFIX}${'0'.repeat(64)}` },
    })
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

test.describe('partner-auth · live boundary — /api/ucp/mcp/p/<slug> connector route', () => {
  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_store_configuration', arguments: {} },
  }

  test('a malformed slug never resolves — 404 (flag off) or 401 (flag on)', async ({ request }) => {
    const res = await request.post(`/api/ucp/mcp/p/${'x'.repeat(200)}`, { data: rpcBody })
    expect([401, 404]).toContain(res.status())
  })

  test('a well-formed but never-issued slug never resolves — 404 or 401/isError, never 500', async ({ request }) => {
    const neverIssued = 'zZ9-_'.repeat(7)
    const res = await request.post(`/api/ucp/mcp/p/${neverIssued}`, { data: rpcBody })
    // Flag off ⇒ deterministic 404. Flag on ⇒ the route forwards and the
    // per-call resolver denies inside the tool result (200 + isError) — the
    // invariant is "never a 5xx, never real data".
    expect(res.status()).toBeLessThan(500)
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.result.isError).toBe(true)
    }
  })

  test('GET (discovery) is flag-gated — 404 flag-off, 200 flag-on, never 5xx', async ({ request }) => {
    const res = await request.get('/api/ucp/mcp/p/whatever-slug')
    expect([200, 404]).toContain(res.status())
  })
})

test.describe('partner-auth · seller-tool schemas advertise shop_slug (S1.4)', () => {
  test('tools/list: every SELLER tool carries the optional shop_slug arg; buyer tools do not', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }> =
      (await res.json()).result.tools
    const byName = new Map(tools.map((t) => [t.name, t]))

    for (const seller of ['list_my_listings', 'patch_store_configuration', 'update_collection']) {
      expect(Object.keys(byName.get(seller)?.inputSchema?.properties ?? {}), `${seller} should offer shop_slug`).toContain('shop_slug')
      // Optional — never in required.
      expect(byName.get(seller)?.inputSchema?.required ?? []).not.toContain('shop_slug')
    }
    for (const buyer of ['search_listings', 'get_listing', 'create_checkout']) {
      expect(Object.keys(byName.get(buyer)?.inputSchema?.properties ?? {}), `${buyer} must NOT offer shop_slug`).not.toContain('shop_slug')
    }
  })
})
