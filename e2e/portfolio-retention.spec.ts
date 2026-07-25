import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRetentionOutcome, RETENTION_OUTCOMES } from '../lib/scorecard/dictionary'
import { isAllowedOutcome, retentionDedupeKey, retentionDueAt } from '../lib/portfolio/retention'

/**
 * Merchant Partner lifecycle · Sprint 3, Story 3.1 (api project, network-free):
 * the 30-day retention check-in (README D7).
 *
 * Three things are proven here:
 *   1. `lib/portfolio/retention.ts`'s pure functions (branch coverage).
 *   2. `isAllowedOutcome` is a genuine RE-EXPORT of
 *      `lib/scorecard/dictionary.ts#isRetentionOutcome` — reference equality,
 *      not a parallel re-implementation — mirroring the exact technique
 *      `e2e/portfolio-sla.spec.ts` already uses for `SLA_STAGES`/`STAGE_ORDINAL`.
 *   3. THE LOAD-BEARING POPULATION GUARD (build contract, Story 3.1): no
 *      module under `lib/portfolio/` imports `@/lib/medusa` — mechanically
 *      re-derived from the filesystem, not a hand-listed set of files.
 *
 * RED-OBSERVED (red-green DoD): the medusa-import guard below was watched
 * fail against a deliberately-added `import { medusa } from '@/lib/medusa'`
 * in a scratch copy of `lib/portfolio/retention-server.ts`, then re-run green
 * after removing it. `retentionDedupeKey`'s namespacing test was watched fail
 * against a version that returned the bare `relationshipId` (no
 * `retention_30d:` prefix), which would have collided with a future
 * differently-kinded dedupe key on the same relationship.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const PORTFOLIO_DIR = join(ROOT, 'lib', 'portfolio')

/** Every `.ts` file under `lib/portfolio/`, re-derived from the filesystem —
 *  same helper shape `e2e/portfolio-sla.spec.ts` already uses, so a module
 *  added later is covered without editing this spec. */
function portfolioSourceFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(PORTFOLIO_DIR)) {
    const full = join(PORTFOLIO_DIR, entry)
    if (statSync(full).isDirectory()) continue
    if (extname(entry) === '.ts') out.push(full)
  }
  return out
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

test.describe('D7 — the retention task hangs off the write-once first_sale TRANSITION, never an order', () => {
  test('retentionDedupeKey is namespaced and deterministic per relationship', () => {
    const a = retentionDedupeKey('11111111-1111-1111-1111-111111111111')
    const b = retentionDedupeKey('11111111-1111-1111-1111-111111111111')
    const c = retentionDedupeKey('22222222-2222-2222-2222-222222222222')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toContain('retention_30d:')
    expect(a).toBe('retention_30d:11111111-1111-1111-1111-111111111111')
  })

  test('retentionDueAt adds the window as a PARAMETER, never a hardcoded 30', () => {
    const firstSale = new Date('2026-01-01T00:00:00.000Z')
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    const due = retentionDueAt(firstSale, thirtyDaysMs)
    expect(due).toBe(new Date(firstSale.getTime() + thirtyDaysMs).toISOString())

    // A DIFFERENT window produces a DIFFERENT due date — proving the window
    // is genuinely threaded through, not silently pinned to 30 inside this
    // file.
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const dueShort = retentionDueAt(firstSale, sevenDaysMs)
    expect(dueShort).not.toBe(due)
  })

  test('lib/portfolio/retention.ts never hardcodes a bare "30" day-count literal', () => {
    const source = read('lib/portfolio/retention.ts')
    // The window is a PARAMETER (`retentionWindowMs`); the real
    // `RETENTION_WINDOW_DAYS = 30` constant lives in the server-only
    // `lib/merchant-medusa-reads.ts` and is threaded in by the impure caller
    // — never duplicated as a literal here.
    expect(source).not.toMatch(/\b30\s*\*\s*24/)
    expect(source).not.toContain('RETENTION_WINDOW_DAYS = 30')
  })
})

test.describe('isAllowedOutcome is a genuine RE-EXPORT of the scorecard dictionary, never a parallel copy', () => {
  test('reference equality — the SAME function object, not a re-implementation', () => {
    expect(isAllowedOutcome).toBe(isRetentionOutcome)
  })

  test('every dictionary outcome is allowed; a random string is not', () => {
    for (const outcome of RETENTION_OUTCOMES) {
      expect(isAllowedOutcome(outcome), outcome).toBe(true)
    }
    expect(isAllowedOutcome('cancelled')).toBe(false)
    expect(isAllowedOutcome('')).toBe(false)
    expect(isAllowedOutcome(null)).toBe(false)
    expect(isAllowedOutcome(42)).toBe(false)
  })

  test('RETENTION_OUTCOMES is exactly the three values this sprint added', () => {
    expect([...RETENTION_OUTCOMES].sort()).toEqual(['at_risk', 'churned', 'retained'])
  })
})

test.describe('the migration CHECK constraint is generated from the dictionary, never a parallel vocabulary', () => {
  test('every RETENTION_OUTCOMES value appears in the migration CHECK', () => {
    const migration = read('supabase/migrations/20260725120000_partner_portfolio_s3.sql')
    expect(migration).toContain('merchant_relationship_tasks_outcome_check')
    for (const outcome of RETENTION_OUTCOMES) {
      expect(migration, outcome).toContain(`'${outcome}'`)
    }
    // The migration states the dictionary is authoritative, in words — a
    // human reviewer's anchor, not itself proof, but its absence would mean
    // the file silently stopped saying so.
    expect(migration).toMatch(/DICTIONARY IS AUTHORITATIVE/i)
  })

  test('the retention task kind CHECK matches lib/portfolio/retention-server.ts\'s own write', () => {
    const migration = read('supabase/migrations/20260725120000_partner_portfolio_s3.sql')
    const server = read('lib/portfolio/retention-server.ts')
    expect(migration).toContain("kind IN ('manual', 'retention_30d')")
    expect(server).toContain("kind: 'retention_30d'")
  })
})

test.describe('THE LOAD-BEARING POPULATION GUARD — no module under lib/portfolio/ imports @/lib/medusa', () => {
  const files = portfolioSourceFiles()

  test('sanity — the population is non-empty and includes the Sprint 3 retention modules', () => {
    const names = files.map((f) => f.split('/').pop())
    expect(files.length).toBeGreaterThan(5)
    expect(names).toContain('retention.ts')
    expect(names).toContain('retention-server.ts')
  })

  for (const file of portfolioSourceFiles()) {
    const rel = file.slice(ROOT.length + 1)
    test(`${rel} does not import @/lib/medusa`, () => {
      const specs = importSpecifiers(readFileSync(file, 'utf8'))
      expect(specs, rel).not.toContain('@/lib/medusa')
      // Also catch a relative escape (e.g. `../medusa`) — the guard is about
      // the MODULE, not the specifier spelling.
      expect(specs.some((s) => /(^|\/)medusa(\.ts)?$/.test(s)), rel).toBe(false)
    })
  }
})

test.describe('the task-complete route extension never touches commerce, emits AFTER the canonical write', () => {
  const source = read('app/api/promoter/relationship/[id]/task/[taskId]/complete/route.ts')

  test('imports the outcome vocabulary by reference, never restates it', () => {
    expect(source).toContain("import { isAllowedOutcome } from '@/lib/portfolio/retention'")
    expect(source).not.toMatch(/'retained'|'at_risk'|'churned'/)
  })

  test('never imports @/lib/medusa', () => {
    expect(source).not.toContain('@/lib/medusa')
  })

  test('outcome/nextAction are only applied on a completion THIS request performed, never the idempotent replay', () => {
    const justCompletedAt = source.indexOf('justCompleted')
    expect(justCompletedAt).toBeGreaterThan(-1)
    // The next-action insert and the two emissions are both gated by
    // `justCompleted` — the idempotent "already completed" replay branch
    // must never re-apply either.
    expect(source).toMatch(/if\s*\(justCompleted\s*&&\s*nextActionTitle\)/)
    expect(source).toMatch(/if\s*\(justCompleted\)\s*\{/)
  })

  test('emits merchant.retention_outcome_recorded and merchant.sla_completed, keyed off the task id', () => {
    expect(source).toContain("event: 'merchant.retention_outcome_recorded'")
    expect(source).toContain("event: 'merchant.sla_completed'")
    // Both emissions key off the TASK ID — one event per task, ever — and build
    // the key with the shared `portfolioEventDedupeKey` helper like every other
    // call site. The assertion used to pin the bare `dedupeKey: taskId` form, which
    // was the ONE place in the epic that didn't use the helper `events.ts` tells
    // callers to always use (fresh-reviewer finding 10, PR 311). Harmless as it
    // stood — `event_type` is part of the emission primary key, so the two events
    // could never collide — but an instruction followed almost-everywhere is how
    // the next drift starts. Asserted on the task id being the KEY INPUT, not on
    // the exact call form, so the guard checks the invariant rather than the syntax.
    // Comments stripped before slicing: an explanatory comment between the `event:`
    // and `dedupeKey:` lines would otherwise push the pairing outside any fixed
    // window, making the guard fail on well-documented code rather than on a defect.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const event of ['merchant.retention_outcome_recorded', 'merchant.sla_completed']) {
      const block = code.slice(code.indexOf(`'${event}'`))
      expect(block.slice(0, 200), event).toMatch(/dedupeKey: portfolioEventDedupeKey\([^)]*taskId\)/)
    }
  })
})
