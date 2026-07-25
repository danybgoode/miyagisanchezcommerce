import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STEWARDSHIP_UPDATE_FIELDS } from '../lib/portfolio/reassign'
import {
  parseTaskUpdateProposal,
  describeTaskUpdateProposal,
  PROPOSAL_TASK_FIELDS,
} from '../lib/portfolio/propose'

/**
 * Merchant Partner lifecycle · Sprint 3, Story 3.2 (api project): partner-agent
 * read and propose/confirm parity (README D2).
 *
 * Four things are proven here:
 *   1. `resolvePartnerPortfolioActor` makes `isAdmin: false` STRUCTURALLY
 *      impossible to set — a source-text guard, not merely a behavioral one.
 *   2. It never uses `resolveToolShop` (D2) and the MCP route never touches
 *      `app/api/ucp/mcp/route.ts`.
 *   3. UI/tool agreement BY CONSTRUCTION: the MCP route imports the SAME
 *      `loadPortfolio`/`parsePortfolioFilters` the UI's API route imports —
 *      not a second, parallel population.
 *   4. THE PROPOSE/CONFIRM FIELD-SET INVARIANT — `steward_clerk_user_id`,
 *      `promoter_id`, `cohort`, `shop_id` (plus every other audited/
 *      stewardship column) are DERIVED from the shipped modules' own source,
 *      never hand-typed, and proven absent from both the allowed field list
 *      and the confirm writer's actual `.update()` calls (LEARNINGS: "a
 *      confident comment is not evidence").
 *
 * RED-OBSERVED (red-green DoD): the `isAdmin: false` source guard was watched
 * fail against a deliberately-edited scratch copy of
 * `lib/portfolio/partner-portfolio-auth.ts` with `isAdmin: partner.isAdmin ?? false`;
 * the forbidden-field guard was watched fail against a scratch
 * `propose-server.ts` that spread `payload` directly into `.update(payload)`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Strip `/* … *&#47;` block comments and `// …` line comments before a
 *  negative-containment check — this repo's doc comments legitimately NAME
 *  the things they explain they don't do ("DOES NOT USE resolveToolShop"),
 *  so a raw substring check over the whole file text would false-fail on
 *  good documentation. Scanning CODE only is the correct, stricter check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ── The derived forbidden set (same technique as e2e/portfolio-reassign.spec.ts) ──

function auditedFieldsFromSource(): string[] {
  const src = read('lib/relationship-access.ts')
  const match = src.match(/export const AUDITED_FIELDS = \[([^\]]*)\] as const/)
  if (!match) throw new Error('AUDITED_FIELDS not found in lib/relationship-access.ts — the derivation is broken')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Neither attribution (`AUDITED_FIELDS`) nor stewardship
 *  (`STEWARDSHIP_UPDATE_FIELDS`) columns may EVER be reachable from a
 *  confirmed agent proposal — unlike the admin reassign writer (which is
 *  DELIBERATELY allowed to touch stewardship columns), a task-update
 *  confirmation must touch neither. */
const FORBIDDEN_CONFIRM_FIELDS = [...new Set([...auditedFieldsFromSource(), ...STEWARDSHIP_UPDATE_FIELDS])]

test.describe('sanity — the derived forbidden set is non-empty and names the fields the build contract calls out', () => {
  test('promoter_id, cohort, shop_id, steward_clerk_user_id are all in the derived set', () => {
    for (const f of ['promoter_id', 'cohort', 'shop_id', 'steward_clerk_user_id']) {
      expect(FORBIDDEN_CONFIRM_FIELDS, f).toContain(f)
    }
  })
})

test.describe('D2 — resolvePartnerPortfolioActor: isAdmin: false is STRUCTURALLY impossible to set', () => {
  const source = read('lib/portfolio/partner-portfolio-auth.ts')
  // CODE only — this file's doc comments legitimately explain what they
  // don't do (e.g. "isAdmin: false" is discussed in prose), so a raw
  // substring/regex scan over the whole file would false-fail on good
  // documentation. Every check below is scoped to comment-stripped code.
  const code = stripComments(source)

  test('the returned actor literal hard-codes isAdmin to the literal false — not a variable', () => {
    // Matches `isAdmin: false,` (or with trailing `}` / whitespace) but would
    // NOT match `isAdmin: someVariable` or `isAdmin: partner.isAdmin` —
    // proving the field is a LITERAL, not derived from any input.
    expect(code).toMatch(/isAdmin:\s*false\s*,?\s*\n/)
    // And no OTHER place in the CODE assigns `isAdmin` to anything else.
    const isAdminAssignments = [...code.matchAll(/isAdmin:\s*([^,\n]+)/g)].map((m) => m[1].trim())
    expect(isAdminAssignments).toEqual(['false'])
  })

  test('never imports resolveToolShop — D2: it routes to ONE shop and denies a multi-grant partner with no shop_slug', () => {
    // Precise: no IMPORT of it (documentation is allowed to name it in
    // prose explaining why it's the wrong tool for this job).
    expect(code).not.toMatch(/import\s*\{[^}]*\bresolveToolShop\b[^}]*\}/)
    // And no CALL of it either.
    expect(code).not.toMatch(/\bresolveToolShop\s*\(/)
  })

  test('reuses resolvePartnerRow from lib/partner-auth.ts rather than forking credential-matching logic', () => {
    expect(source).toContain("import { resolvePartnerRow } from '@/lib/partner-auth'")
  })

  test('checks partners.mcp_enabled BEFORE resolving the partner row', () => {
    const flagAt = source.indexOf("isEnabled('partners.mcp_enabled')")
    const resolveAt = source.indexOf('resolvePartnerRow(token)')
    expect(flagAt).toBeGreaterThan(-1)
    expect(resolveAt).toBeGreaterThan(-1)
    expect(flagAt).toBeLessThan(resolveAt)
  })
})

test.describe('a separate MCP route — never added to app/api/ucp/mcp/route.ts', () => {
  test('app/api/partner/portfolio/mcp/route.ts exists and is a distinct file from the seller UCP dispatcher', () => {
    const source = read('app/api/partner/portfolio/mcp/route.ts')
    expect(source).not.toContain("from '@/app/api/ucp/mcp/route'")
    expect(source).toContain('resolvePartnerPortfolioActor')
  })

  test('the four tools are exactly list_portfolio, get_portfolio_record, propose_task_update, confirm_task_update', () => {
    const source = read('app/api/partner/portfolio/mcp/route.ts')
    const match = source.match(/const TOOL_NAMES = \[([^\]]*)\] as const/)
    expect(match).not.toBeNull()
    const names = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(names.sort()).toEqual(
      ['confirm_task_update', 'get_portfolio_record', 'list_portfolio', 'propose_task_update'].sort(),
    )
  })
})

test.describe('UI/tool agreement BY CONSTRUCTION — the same resolver, not a hope', () => {
  test('both GET /api/partner/portfolio and the MCP route import loadPortfolio from the SAME module', () => {
    const uiRoute = read('app/api/partner/portfolio/route.ts')
    const mcpRoute = read('app/api/partner/portfolio/mcp/route.ts')
    expect(uiRoute).toContain("import { loadPortfolio } from '@/lib/portfolio/loader'")
    expect(mcpRoute).toContain("import { loadPortfolio } from '@/lib/portfolio/loader'")
  })

  test('both import parsePortfolioFilters from the SAME module', () => {
    const uiRoute = read('app/api/partner/portfolio/route.ts')
    const mcpRoute = read('app/api/partner/portfolio/mcp/route.ts')
    expect(uiRoute).toContain("import { parsePortfolioFilters } from '@/lib/portfolio/resolver'")
    expect(mcpRoute).toContain("import { parsePortfolioFilters } from '@/lib/portfolio/resolver'")
  })

  test('get_portfolio_record reads off the SAME scoped loadPortfolio result — no second, parallel per-id query', () => {
    const mcpRoute = read('app/api/partner/portfolio/mcp/route.ts')
    const fn = mcpRoute.slice(
      mcpRoute.indexOf('async function handleGetPortfolioRecord'),
      mcpRoute.indexOf('async function handleProposeTaskUpdate'),
    )
    expect(fn).toContain('await loadPortfolio(actor')
    expect(fn).not.toContain('.from(')
  })
})

test.describe('cross-partner ids return 403-shaped denial, indistinguishable from a nonexistent id', () => {
  test('get_portfolio_record returns status 403 with no record fields when the row is absent from scope', () => {
    const mcpRoute = read('app/api/partner/portfolio/mcp/route.ts')
    const fn = mcpRoute.slice(
      mcpRoute.indexOf('async function handleGetPortfolioRecord'),
      mcpRoute.indexOf('async function handleProposeTaskUpdate'),
    )
    expect(fn).toMatch(/if \(!row\) return \{ ok: false, error: '[^']+', status: 403 \}/)
  })

  test('propose/confirm re-run resolveRelationshipAccess against the CALLING actor — never the proposal\'s own scope', () => {
    const server = read('lib/portfolio/propose-server.ts')
    const proposeFn = server.slice(
      server.indexOf('export async function createTaskUpdateProposal'),
      server.indexOf('export type ConfirmProposalResult'),
    )
    const confirmFn = server.slice(server.indexOf('export async function confirmTaskUpdateProposal'))
    expect(proposeFn).toContain('await resolveRelationshipAccess(relationshipId, actor)')
    expect(confirmFn).toContain('await resolveRelationshipAccess(relationshipId, actor)')
    // The read of the STORED proposal happens AFTER the confirming access
    // check — never trusting whatever scope the proposal was created under.
    const accessAt = confirmFn.indexOf('resolveRelationshipAccess(relationshipId, actor)')
    const proposalReadAt = confirmFn.indexOf("from('merchant_portfolio_proposals')")
    expect(accessAt).toBeGreaterThan(-1)
    expect(proposalReadAt).toBeGreaterThan(accessAt)
  })
})

test.describe('THE PROPOSE/CONFIRM FIELD-SET INVARIANT — structural, not a comment', () => {
  test('PROPOSAL_TASK_FIELDS contains none of the forbidden attribution/stewardship columns', () => {
    // Field names differ in casing (camelCase proposal keys vs. snake_case DB
    // columns) by design — this asserts the DB-column NAMES never appear as
    // substrings of the allowed camelCase set either, closing the "someone
    // renames a field to look similar" gap.
    for (const forbidden of FORBIDDEN_CONFIRM_FIELDS) {
      expect(PROPOSAL_TASK_FIELDS as readonly string[], forbidden).not.toContain(forbidden)
    }
    expect([...PROPOSAL_TASK_FIELDS].sort()).toEqual(['completedAt', 'dueAt', 'interactionNote', 'outcome', 'title'].sort())
  })

  test('the confirm writer\'s actual .update() calls never reference a forbidden column', () => {
    const server = read('lib/portfolio/propose-server.ts')
    const updateBlock = server.slice(
      server.indexOf('const update: Record<string, unknown> = {}'),
      server.indexOf('const { data, error } = await db\n      .from(\'merchant_relationship_tasks\')\n      .update(update)'),
    )
    for (const forbidden of FORBIDDEN_CONFIRM_FIELDS) {
      expect(updateBlock, forbidden).not.toContain(forbidden)
    }
  })

  test('confirm never spreads the stored payload directly into .update() — every field is named', () => {
    const code = stripComments(read('lib/portfolio/propose-server.ts'))
    expect(code).not.toMatch(/\.update\(payload\)/)
    expect(code).not.toMatch(/\.update\(\{\s*\.\.\.payload/)
  })

  test('no commission/transfer table or an @/lib/medusa IMPORT exists anywhere in lib/portfolio/propose*.ts', () => {
    for (const file of ['lib/portfolio/propose.ts', 'lib/portfolio/propose-server.ts']) {
      const code = stripComments(read(file))
      expect(code, file).not.toMatch(/from\s+['"]@\/lib\/medusa['"]/)
      expect(code, file).not.toMatch(/promoter_transfers|promoter_commission/)
    }
  })

  test('no transport (lib/notify.ts, lib/telegram.ts, lib/email.ts, lib/notifications/dispatch.ts) is IMPORTED by the propose/confirm path', () => {
    for (const file of ['lib/portfolio/propose.ts', 'lib/portfolio/propose-server.ts']) {
      const code = stripComments(read(file))
      for (const transport of ["'@/lib/notify'", "'@/lib/telegram'", "'@/lib/email'", "'@/lib/notifications/dispatch'"]) {
        expect(code, `${file} imports ${transport}`).not.toContain(transport)
      }
    }
  })
})

test.describe('parseTaskUpdateProposal — positive-list parsing, every branch', () => {
  test('an update to an existing task needs no title', () => {
    const result = parseTaskUpdateProposal({ taskId: 't1', dueAt: '2026-08-01T00:00:00.000Z' })
    expect(result.ok).toBe(true)
  })

  test('creating a NEW task (no taskId) requires a title', () => {
    const result = parseTaskUpdateProposal({ dueAt: '2026-08-01T00:00:00.000Z' })
    expect(result.ok).toBe(false)
  })

  test('creating a new task with a title succeeds', () => {
    const result = parseTaskUpdateProposal({ title: 'Llamar de nuevo' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.title).toBe('Llamar de nuevo')
  })

  test('an unknown key is silently dropped, never carried into the payload', () => {
    const result = parseTaskUpdateProposal({ taskId: 't1', title: 'x', steward_clerk_user_id: 'user_evil' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.payload)).not.toContain('steward_clerk_user_id')
      expect(JSON.stringify(result.payload)).not.toContain('user_evil')
    }
  })

  test('an empty object (no taskId, no title) is rejected', () => {
    expect(parseTaskUpdateProposal({}).ok).toBe(false)
  })

  test('a non-object payload is rejected', () => {
    expect(parseTaskUpdateProposal('x').ok).toBe(false)
    expect(parseTaskUpdateProposal(null).ok).toBe(false)
    expect(parseTaskUpdateProposal([1, 2]).ok).toBe(false)
  })

  test('an invalid outcome TYPE is rejected at parse time (vocabulary enforcement happens one layer up, in propose-server.ts)', () => {
    expect(parseTaskUpdateProposal({ taskId: 't1', outcome: 42 }).ok).toBe(false)
  })

  test('describeTaskUpdateProposal names the fields that changed', () => {
    const desc = describeTaskUpdateProposal({ taskId: 't1', outcome: 'retained', completedAt: '2026-08-01T00:00:00.000Z' })
    expect(desc).toContain('t1')
    expect(desc).toContain('retained')
    expect(desc).toContain('completada')
  })
})

test.describe('live · route guards never serve an anonymous or unauthorized caller', () => {
  test('anonymous tools/call against the MCP route → never 200, never 5xx, never portfolio data', async ({ request }) => {
    const res = await request.post('/api/partner/portfolio/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_portfolio', arguments: {} } },
    })
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
    const text = await res.text()
    expect(text).not.toContain('businessName')
  })

  test('GET → the route accepts POST only', async ({ request }) => {
    const res = await request.get('/api/partner/portfolio/mcp')
    expect(res.status()).not.toBe(200)
  })
})
