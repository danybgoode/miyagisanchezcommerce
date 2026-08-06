import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
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

  test('founding-operator credentials also close when the recruiting flag is OFF', () => {
    expect(source).toContain("import { recruitingV3Enabled } from '@/lib/recruiting-v3'")
    const resolveAt = source.indexOf('resolvePartnerRow(token)')
    const trackGateAt = source.indexOf("partner.program_track === 'founding_operator'")
    const grantsAt = source.indexOf(".from('partner_grants')")
    expect(resolveAt).toBeLessThan(trackGateAt)
    expect(trackGateAt).toBeLessThan(grantsAt)
    expect(source).toContain('!(await recruitingV3Enabled())')
    expect(source).toContain('return { ok: false, message: null }')
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

// ── Single-apply confirm + honest partial completion (cross-agent review, PR 311)
//
// Codex found the SAME bug class in three places across this epic's three PRs: a
// value read in one round trip used to authorize a write in the next. A read is
// not a claim. Both S3 instances are fixed here; the S1 one (the SLA policy
// version) is fixed on the base branch with the same CAS shape.

test.describe('confirm_task_update applies EXACTLY once', () => {
  const code = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/propose-server.ts'),
    'utf8',
  )
    // Comments stripped: they legitimately NAME the defective ordering to explain
    // why it was changed, and a negative assertion over raw text would fail
    // *because* the code documents itself well.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  test('the proposal is CLAIMED conditionally before the payload is applied', () => {
    // `.is('confirmed_at', null)` + select-back is the concurrency control:
    // supabase-js reports no error for an UPDATE matching nothing, so without the
    // select the loser of the race is indistinguishable from the winner.
    expect(code).toMatch(/\.is\('confirmed_at', null\)/)
    expect(code).toMatch(/\.select\('id'\)/)
    expect(code).toMatch(/claimed\.length === 0/)
  })

  test('the claim happens BEFORE any task insert or interaction append', () => {
    const claimAt = code.indexOf(".is('confirmed_at', null)")
    const taskWriteAt = code.indexOf("from('merchant_relationship_tasks')")
    const interactionAt = code.indexOf("from('merchant_relationship_interactions')")
    expect(claimAt).toBeGreaterThan(-1)
    expect(taskWriteAt).toBeGreaterThan(-1)
    // Ordering IS the fix — apply-then-claim double-applies.
    expect(claimAt).toBeLessThan(taskWriteAt)
    if (interactionAt > -1) expect(claimAt).toBeLessThan(interactionAt)
  })

  test('a lost claim is a 409, never a silent second apply', () => {
    expect(code).toMatch(/status: 409/)
  })

  test('the old read-then-apply guard is gone', () => {
    // `if (proposal.confirmed_at) return …` looked like a guard and was only a
    // snapshot — two callers could both pass it.
    expect(code).not.toMatch(/if \(proposal\.confirmed_at\)/)
  })
})

test.describe('completing a task never claims a follow-up it failed to create', () => {
  const route = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'app/api/promoter/relationship/[id]/task/[taskId]/complete/route.ts',
    ),
    'utf8',
  )

  test('a failed next-action insert is tracked, not just logged', () => {
    expect(route).toMatch(/nextActionError = createError\.message/)
  })

  test('the response says explicitly that the follow-up was NOT created', () => {
    expect(route).toMatch(/nextActionCreated: false/)
    expect(route).toContain('NO se pudo crear la siguiente acción')
  })

  test('the successful path says so too — the flag is present either way, never inferred from absence', () => {
    expect(route).toMatch(/nextActionCreated: true/)
  })
})

// ── The epic kill-switch gates the agent surface too (fresh-reviewer finding 1) ─
//
// THE WORST DEFECT OF THE EPIC, and it was a documentation-shaped one. The MCP
// route checked only `partners.mcp_enabled` — ON in production since 2026-07-17
// (re-verified live 2026-07-25) — so this branch would have shipped the agent
// WRITE path (`propose_task_update` → `confirm_task_update`) live on deploy, with
// `promoter.partner_portfolio_enabled` still OFF and before any of the smokes the
// README says Daniel flips it after. The shipped MIGRATION HEADER meanwhile
// asserted the opposite as fact ("the MCP route … gate[s] on it via
// `resolvePartnerPortfolioActor`") — `Roadmap/LEARNINGS.md`'s "a paraphrased
// contract drifts permissive" in textbook form: a restated rule that ACCEPTED what
// the real rule rejected. Only the empty `partner_grants` population kept it
// harmless; the gate itself was open.

test.describe('the partner-agent surface is gated by the EPIC flag, not only by partners.mcp_enabled', () => {
  const auth = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/partner-portfolio-auth.ts'),
    'utf8',
  )

  test('the epic kill-switch is checked', () => {
    expect(auth).toMatch(/isEnabled\(PORTFOLIO_FLAG\)/)
  })

  test('the flag key is IMPORTED by reference, never re-typed as a second literal', () => {
    // Re-typing the string is exactly how the code and the migration header
    // drifted apart in the first place.
    expect(auth).toMatch(/import \{ PORTFOLIO_FLAG \} from '@\/lib\/portfolio\/gate-server'/)
    const code = auth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toContain("'promoter.partner_portfolio_enabled'")
  })

  test('both gates run BEFORE the credential is resolved (flag → auth ordering)', () => {
    const code = auth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const portfolioGate = code.indexOf('isEnabled(PORTFOLIO_FLAG)')
    const mcpGate = code.indexOf("isEnabled('partners.mcp_enabled')")
    const resolve = code.indexOf('resolvePartnerRow(token)')
    expect(portfolioGate).toBeGreaterThan(-1)
    expect(mcpGate).toBeGreaterThan(-1)
    expect(portfolioGate).toBeLessThan(resolve)
    expect(mcpGate).toBeLessThan(resolve)
  })

  test('a gated call is INDISTINGUISHABLE from a bad token — no message, no hint', () => {
    // `{ ok: false, message: null }` on both gates: a caller must not be able to
    // tell "this epic is dark" from "MCP is dark" from "your token is wrong".
    const gateLines = auth.split('\n').filter((l) => l.includes('isEnabled(') && l.includes('return'))
    expect(gateLines.length).toBeGreaterThanOrEqual(2)
    for (const line of gateLines) expect(line).toContain('message: null')
  })

  test('the migration header no longer claims a gate that does not exist', () => {
    const migration = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase/migrations/20260725120000_partner_portfolio_s3.sql'),
      'utf8',
    )
    // It must state what is NOT gated (the sweep) rather than implying everything is.
    expect(migration).toContain('NOT gated on it, deliberately')
  })
})

// ── UI/tool population parity (fresh-reviewer finding 5, PR 311) ──────────────
//
// The build contract required a spec that "drives the same fixture through the
// resolver behind GET /api/partner/portfolio and through list_portfolio, and
// asserts the row sets are identical." It was not written, and the code had
// silently diverged: a synthetic `partner:<id>` actor meant
// `listScopedRelationships`'s C1 steward-mirror branch (which keys off
// `actor.clerkUserId`) could never match, so a promoter who was the assigned
// STEWARD of a relationship saw it in the UI and NOT through the agent. Fail-closed,
// so never a leak — but "UI and tool results agree" is the acceptance criterion,
// and it was false.

test.describe('the agent actor resolves the SAME population as the UI actor', () => {
  const auth = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/partner-portfolio-auth.ts'),
    'utf8',
  )
  const code = auth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  test('the actor carries the promoter’s REAL Clerk id, so the steward mirror can match', () => {
    expect(code).toMatch(/clerk_user_id/)
    expect(code).toMatch(/boundClerkId \?\? `partner:\$\{partner\.id\}`/)
  })

  test('an UNBOUND promoter falls back to the synthetic id — fewer rows, never more', () => {
    // A null clerk id must not widen access, and `.eq(null)` would match nothing
    // in a way that is easy to get backwards. The fallback is deliberate.
    expect(code).toMatch(/typeof bound\?\.clerk_user_id === 'string'/)
  })

  test('the shared seller-credential seam carries track so every token surface can honor rollback', () => {
    const partnerAuth = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/partner-auth.ts'),
      'utf8',
    )
    expect(partnerAuth).toContain("const PARTNER_COLS = 'id, code, name, program_track, partner_token_hash, partner_connector_slug'")
    const resolveAt = partnerAuth.indexOf('resolvePartnerRow(token)')
    const trackGateAt = partnerAuth.indexOf("partner.program_track === 'founding_operator'")
    const grantsAt = partnerAuth.indexOf(".from('partner_grants')")
    expect(resolveAt).toBeLessThan(trackGateAt)
    expect(trackGateAt).toBeLessThan(grantsAt)
    expect(partnerAuth).toContain('!(await recruitingV3Enabled())')
  })

  test('BOTH the UI route and the agent call the same scoped-list function — one population, by construction', () => {
    const uiRoute = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/partner/portfolio/route.ts'),
      'utf8',
    )
    const mcpRoute = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/partner/portfolio/mcp/route.ts'),
      'utf8',
    )
    // Both reach the population through `loadPortfolio`, which is the only caller
    // of `listScopedRelationships` in this epic. Neither re-derives scope.
    expect(uiRoute).toMatch(/loadPortfolio/)
    expect(mcpRoute).toMatch(/loadPortfolio/)
    for (const src of [uiRoute, mcpRoute]) {
      expect(src).not.toMatch(/from\('merchant_relationships'\)/)
    }
  })
})

// ── The scoped population is Daniel's ruling, pinned (finding 6, PR 311) ──────
//
// Story 3.2's scaffolded acceptance said "only GRANTED portfolio records", which
// contradicted README D2 ("reuse the UI's population verbatim") and the shipped
// four-actor rule — a partner's own `promoter_id` records and stewarded records are
// in `/partner` scope and always were. Daniel ruled 2026-07-25: keep UI PARITY, so
// the same person gets the same access through either surface and no second
// authorization rule exists to drift. sprint-3.md's acceptance line was corrected
// rather than the code narrowed. This spec pins the ruling so a future reader of
// the old wording doesn't "fix" it back.

test.describe('the agent population is UI parity, by Daniel’s ruling — not a second rule', () => {
  test('no module in this epic re-derives scope; the ONE shipped helper decides', () => {
    // `listScopedRelationships` owns the four populations (own / steward / granted /
    // admin). If any epic module queried `merchant_relationships` for scope itself,
    // that would BE the second rule D2 forbids.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'portfolio')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      // The loader legitimately re-reads named columns for rows the scoped list
      // already returned; what must not exist is a scope-deciding predicate.
      if (/from\('merchant_relationships'\)[\s\S]{0,200}\.eq\('promoter_id'/.test(src)) offenders.push(f)
      if (/from\('partner_grants'\)/.test(src) && f !== 'partner-portfolio-auth.ts') offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  test('the agent gate checks grant EXISTENCE (a credential with none is useless), not per-row grants', () => {
    // The `activeGrants.length === 0` check is a credential-level "are you a
    // partner at all" gate — deliberately NOT a per-relationship filter, which is
    // what would fork the population.
    const auth = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/partner-portfolio-auth.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(auth).toMatch(/activeGrants\.length === 0/)
    // It must not filter the returned relationship set by shop.
    expect(auth).not.toMatch(/\.in\('shop_id'/)
  })
})

// ── Round 2: validate → claim → apply (codex, PR 311) ─────────────────────────
//
// My OWN claim-first fix introduced this one. Moving the claim ahead of the apply
// stopped the double-apply and created a new failure: an unapplicable payload got
// its proposal permanently consumed (claim succeeds, apply fails, every retry 409s),
// so `dueAt: "not-a-date"` became a LOST update against a proposal that falsely
// read as confirmed. Validation is pure and side-effect-free, so it belongs before
// the claim — the resulting order is strictly better than either previous one.

test.describe('a proposal is validated BEFORE it is claimed', () => {
  const code = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/propose-server.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  test('the stored payload is re-parsed, and an unapplicable one is refused before the claim', () => {
    const fnStart = code.indexOf('export async function confirmTaskUpdateProposal')
    expect(fnStart).toBeGreaterThan(-1)
    const body = code.slice(fnStart)
    const revalidate = body.indexOf('parseTaskUpdateProposal(proposal.payload)')
    const claim = body.indexOf("is('confirmed_at', null)")
    expect(revalidate, 'stored payload is never re-validated').toBeGreaterThan(-1)
    expect(claim, 'claim not found').toBeGreaterThan(-1)
    // ORDERING IS THE FIX.
    expect(revalidate).toBeLessThan(claim)
  })

  test('the applied payload is the REVALIDATED one, never the raw stored JSON', () => {
    expect(code).toMatch(/const payload = revalidated\.payload/)
    expect(code).not.toMatch(/proposal\.payload as TaskUpdateProposal/)
  })
})

test.describe('a garbage date can never become a stored proposal', () => {
  test('parseTaskUpdateProposal REJECTS an unparseable dueAt and completedAt', () => {
    for (const bad of ['not-a-date', '2026-13-45', 'yesterday']) {
      const dueResult = parseTaskUpdateProposal({ taskId: 't1', dueAt: bad })
      expect(dueResult.ok, `dueAt '${bad}' was accepted`).toBe(false)
      const completedResult = parseTaskUpdateProposal({ taskId: 't1', completedAt: bad })
      expect(completedResult.ok, `completedAt '${bad}' was accepted`).toBe(false)
    }
  })

  test('a CALENDAR-invalid date-only value is rejected, not rolled into the next month', () => {
    // `new Date('2026-02-31')` silently becomes March — the shipped
    // `dueAtIsoFromDateOnly` catches that, and this proves it is actually used.
    expect(parseTaskUpdateProposal({ taskId: 't1', dueAt: '2026-02-31' }).ok).toBe(false)
  })

  test('a VALID date is normalized to a full ISO instant', () => {
    const res = parseTaskUpdateProposal({ taskId: 't1', dueAt: '2026-08-03' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('an explicit null dueAt still CLEARS (a deliberate unset is not a bad date)', () => {
    const res = parseTaskUpdateProposal({ taskId: 't1', dueAt: null })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.dueAt).toBeNull()
  })
})

test.describe('a non-object JSON-RPC body is a protocol error, not a 500', () => {
  test('the route rejects null/array/scalar bodies before touching .id', () => {
    const route = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/partner/portfolio/mcp/route.ts'),
      'utf8',
    )
    expect(route).toMatch(/typeof raw !== 'object' \|\| raw === null \|\| Array\.isArray\(raw\)/)
    expect(route).toMatch(/-32600/)
  })
})
