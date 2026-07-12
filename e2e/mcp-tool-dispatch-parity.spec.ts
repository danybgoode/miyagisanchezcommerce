import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { MCP_TOOL_NAMES } from '../lib/ucp/capabilities'

/**
 * Regression guard for a real bug (cross-agent review, 2026-07-07,
 * own-shop-premium-presentation S2): `list_my_collections` was declared in
 * `TOOLS`, listed in `MCP_SELLER_TOOLS`, and had a complete handler
 * (`handleListMyCollections`) — but no `case 'list_my_collections':` in the
 * `tools/call` dispatch switch, so calling it returned MethodNotFound. This
 * slipped every layer (tsc, build, the live smoke) because a declared-but-
 * undispatched tool isn't a type error or a build error — it's a pure
 * behavioral gap only a call-time check catches.
 *
 * Static source parse (no server/auth needed) — every tool name in the
 * `TOOLS` array must have a matching `case '<name>':` in the dispatch
 * switch. Mirrors the drift-guard shape already used for the seller nav
 * (`seller-mode.spec.ts`'s `REAL_MANAGE_ROUTES`).
 */

const ROUTE_SOURCE = readFileSync(new URL('../app/api/ucp/mcp/route.ts', import.meta.url), 'utf-8')

function extractToolNames(source: string): string[] {
  const toolsBlockMatch = source.match(/const TOOLS = \[([\s\S]*?)\n\]\n/)
  if (!toolsBlockMatch) throw new Error('Could not locate the TOOLS array in route.ts — did it get renamed?')
  const nameMatches = [...toolsBlockMatch[1].matchAll(/^\s*name: '([a-z_]+)',/gm)]
  return nameMatches.map((m) => m[1])
}

function extractDispatchedCases(source: string): string[] {
  const switchBlockMatch = source.match(/switch \(name\) \{([\s\S]*?)\n {4}\}\n/)
  if (!switchBlockMatch) throw new Error('Could not locate the tools/call dispatch switch in route.ts — did it get restructured?')
  const caseMatches = [...switchBlockMatch[1].matchAll(/case '([a-z_]+)':/g)]
  return caseMatches.map((m) => m[1])
}

test.describe('MCP tool dispatch parity', () => {
  test('every declared tool has a dispatch case', () => {
    const toolNames = extractToolNames(ROUTE_SOURCE)
    const dispatchedCases = extractDispatchedCases(ROUTE_SOURCE)
    expect(toolNames.length).toBeGreaterThan(10) // sanity: the parse actually found real entries

    const missing = toolNames.filter((n) => !dispatchedCases.includes(n))
    expect(missing, `Tool(s) declared in TOOLS but never dispatched: ${missing.join(', ')}`).toEqual([])
  })

  test('list_my_collections specifically is dispatched (the exact bug this guard catches)', () => {
    const dispatchedCases = extractDispatchedCases(ROUTE_SOURCE)
    expect(dispatchedCases).toContain('list_my_collections')
  })
})

/**
 * Manifest-sync drift guard (mcp-parity-core S1.4). `lib/ucp/capabilities.ts`'s
 * `MCP_TOOL_NAMES` is hand-maintained, NOT derived from the live `TOOLS` array
 * in route.ts — a real tool can exist, be dispatched, and still be missing
 * from the manifest/agent briefing page (confirmed: `list_launchpad_campaigns`,
 * `stage_bulk_action`, `apply_bulk_action`, `start_shopify_migration` were all
 * live-and-dispatched but absent from `MCP_TOOL_NAMES` before this sprint).
 * Asserts the two lists are the SAME SET in both directions, so this class of
 * drift becomes a permanently red build rather than a one-time fix.
 */
test.describe('MCP manifest ⇄ dispatch parity (both directions)', () => {
  test('every declared+dispatched tool is advertised in MCP_TOOL_NAMES', () => {
    const toolNames = extractToolNames(ROUTE_SOURCE)
    const missingFromManifest = toolNames.filter((n) => !MCP_TOOL_NAMES.includes(n))
    expect(missingFromManifest, `Tool(s) declared+dispatched but missing from MCP_TOOL_NAMES: ${missingFromManifest.join(', ')}`).toEqual([])
  })

  test('every name in MCP_TOOL_NAMES is a real, declared tool', () => {
    const toolNames = extractToolNames(ROUTE_SOURCE)
    const stale = MCP_TOOL_NAMES.filter((n) => !toolNames.includes(n))
    expect(stale, `MCP_TOOL_NAMES lists tool(s) no longer declared in TOOLS: ${stale.join(', ')}`).toEqual([])
  })
})
