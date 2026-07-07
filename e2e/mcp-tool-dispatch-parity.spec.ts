import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

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
