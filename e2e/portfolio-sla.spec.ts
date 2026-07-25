import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES, STAGE_ORDINAL } from '../lib/merchant-stage'
import { SCORECARD_TIMEZONE } from '../lib/scorecard/dictionary'
import * as pipeline from '../lib/relationship-pipeline'
import {
  DEFAULT_SLA_POLICY,
  SLA_POLICY_VERSION,
  SLA_STAGES,
  SLA_STAGE_ORDINAL,
  SLA_TIMEZONE,
  parseSlaPolicy,
  resolveSlaState,
  serializeSlaPolicy,
  windowForStage,
  type SlaFacts,
  type SlaPolicy,
} from '../lib/portfolio/sla'

/**
 * Merchant Partner lifecycle · Sprint 1, Story 1.1 (api project, network-free):
 * the SLA contract. `lib/portfolio/sla.ts` is zero-import beyond three
 * zero-import modules (`lib/merchant-stage.ts`, `lib/relationship-pipeline.ts`,
 * `lib/scorecard/dictionary.ts`), so every assertion below runs with no
 * database, no Clerk, no Next.
 *
 * Two things are proven here, and the second one is the point:
 *   1. `resolveSlaState` / `parseSlaPolicy` behave (branch coverage).
 *   2. NOTHING in `lib/portfolio/` restates a stage list, an overdue rule, an
 *      aging rule or a threshold that already ships (README D3). That is
 *      enforced by REFERENCE EQUALITY plus a POPULATION guard that re-derives
 *      the file set from the filesystem and the predicate set from the shipped
 *      module's own exports — never from a hand-written list of the files or
 *      functions that happened to exist the day this spec was written
 *      (LEARNINGS: "guard the population, not the door you found").
 *
 * RED-OBSERVED (red-green DoD): see the PR body. Each describe below was
 * watched fail once before the implementation satisfied it — the
 * no-restatement guard was watched fail against a deliberately-planted local
 * `function isOverdue(...)` in `lib/portfolio/sla.ts`, and the
 * reference-equality tests against a deliberately-copied `[...STAGES]`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTFOLIO_DIR = join(ROOT, 'lib', 'portfolio')
const SLA_SOURCE = readFileSync(join(PORTFOLIO_DIR, 'sla.ts'), 'utf8')

/** Every `.ts` file under `lib/portfolio/`, re-derived from the filesystem so a
 *  module added later is covered by the guards below without editing them. */
function portfolioSourceFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(PORTFOLIO_DIR)) {
    const full = join(PORTFOLIO_DIR, entry)
    if (statSync(full).isDirectory()) continue
    if (extname(entry) === '.ts') out.push(full)
  }
  return out
}

test.describe('D3 — the SLA layer IMPORTS the shipped contract, never restates it', () => {
  test('SLA_STAGES is the SAME array object as STAGES (reference equality, not a copy)', () => {
    expect(SLA_STAGES).toBe(STAGES)
  })

  test('SLA_STAGE_ORDINAL is the SAME object as STAGE_ORDINAL', () => {
    expect(SLA_STAGE_ORDINAL).toBe(STAGE_ORDINAL)
  })

  test('SLA_TIMEZONE is the scorecard dictionary constant BY REFERENCE, not a second string literal', () => {
    expect(SLA_TIMEZONE).toBe(SCORECARD_TIMEZONE)
    expect(SLA_TIMEZONE).toBe('America/Mexico_City')
    // A parallel literal would satisfy the value check above but not this one:
    // the source text must never spell the timezone out itself.
    expect(SLA_SOURCE).not.toContain('America/Mexico_City')
  })

  test('the stage population is re-derived, not enumerated: every STAGES member has a window', () => {
    for (const stage of STAGES) {
      const w = windowForStage(DEFAULT_SLA_POLICY, stage)
      expect(Number.isInteger(w.responseDays), stage).toBe(true)
      expect(w.responseDays, stage).toBeGreaterThan(0)
      // A stage can never be "stalled" sooner than it can be "unattended".
      expect(w.stallDays, stage).toBeGreaterThanOrEqual(w.responseDays)
    }
    expect(Object.keys(DEFAULT_SLA_POLICY.stages).sort()).toEqual([...STAGES].sort())
  })

  test('SLA_POLICY_VERSION is a positive integer and the code default carries it', () => {
    expect(Number.isInteger(SLA_POLICY_VERSION)).toBe(true)
    expect(SLA_POLICY_VERSION).toBeGreaterThan(0)
    expect(DEFAULT_SLA_POLICY.version).toBe(SLA_POLICY_VERSION)
  })
})

test.describe('D3 population guard — no module under lib/portfolio/ redefines a shipped predicate', () => {
  // The population is the SHIPPED module's own export list, read at runtime —
  // not a hand-typed set of the six predicates that existed when this spec was
  // written. A seventh predicate added to lib/relationship-pipeline.ts is
  // covered automatically.
  const SHIPPED_PREDICATES = Object.keys(pipeline).filter(
    (name) => typeof (pipeline as Record<string, unknown>)[name] === 'function',
  )

  test('sanity — the shipped predicate population is non-empty and includes the named rules', () => {
    expect(SHIPPED_PREDICATES.length).toBeGreaterThan(0)
    for (const name of ['isOverdue', 'isMissingAction', 'nextOpenTask', 'ageInStageDays', 'hasBlocker', 'dueAtIsoFromDateOnly']) {
      expect(SHIPPED_PREDICATES, name).toContain(name)
    }
  })

  for (const name of SHIPPED_PREDICATES) {
    test(`no lib/portfolio module declares its own "${name}"`, () => {
      const offenders: string[] = []
      for (const file of portfolioSourceFiles()) {
        const text = readFileSync(file, 'utf8')
        // A local declaration in ANY form — `function x(`, `const x =`,
        // `let x =`. An IMPORT of the same name is fine (that is the point);
        // imports never match these shapes.
        const declared =
          new RegExp(`(^|\\n)\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\b`).test(text) ||
          new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${name}\\b`).test(text)
        if (declared) offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
      }
      expect(offenders).toEqual([])
    })
  }

  test('no lib/portfolio module declares its own STAGES / STAGE_ORDINAL', () => {
    const offenders: string[] = []
    for (const file of portfolioSourceFiles()) {
      const text = readFileSync(file, 'utf8')
      if (/(^|\n)\s*(export\s+)?(const|let|var)\s+(STAGES|STAGE_ORDINAL)\b/.test(text)) {
        offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  test('sla.ts is genuinely zero-import: no server-only, no next, no Clerk, no Supabase', () => {
    for (const forbidden of ["'server-only'", "'next/", "'@clerk/", "@/lib/supabase", "@/lib/flags"]) {
      expect(SLA_SOURCE.includes(forbidden), forbidden).toBe(false)
    }
  })

  test('sla.ts restates no retention-window numeral (that constant is server-only and is NOT imported here)', () => {
    // The retention window lives in lib/merchant-medusa-reads.ts (server-only).
    // sla.ts must neither import it nor re-type its value.
    expect(SLA_SOURCE).not.toMatch(/^\s*import[^\n]*merchant-medusa-reads/m)
    // Naming it in PROSE is required (the deviation is documented in the file
    // header); DEFINING or IMPORTING it is what must never happen — the same
    // distinction e2e/scorecard-dictionary.spec.ts draws.
    expect(SLA_SOURCE).not.toMatch(/RETENTION_WINDOW_DAYS\s*=\s*\d/)
    expect(SLA_SOURCE).not.toMatch(/import[^\n]*\bRETENTION_WINDOW_DAYS\b/)
    // No window below may coincidentally BE the retention window either — a
    // reader must never be able to mistake one for the other.
    for (const stage of STAGES) {
      const w = DEFAULT_SLA_POLICY.stages[stage]
      expect(w.responseDays, stage).not.toBe(30)
      expect(w.stallDays, stage).not.toBe(30)
    }
  })
})

// ── resolveSlaState ──────────────────────────────────────────────────────────

const NOW = new Date('2026-07-24T18:00:00.000Z')
const DAY = 86_400_000

function iso(offsetDays: number, from: Date = NOW): string {
  return new Date(from.getTime() + offsetDays * DAY).toISOString()
}

function facts(over: Partial<SlaFacts> = {}): SlaFacts {
  return {
    stage: 'qualified',
    stageEnteredAt: iso(-1),
    openTasks: [],
    lastInteractionAt: null,
    escalationClerkUserId: null,
    ...over,
  }
}

test.describe('resolveSlaState — the overdue REASON is explainable, never a bare boolean', () => {
  test('a dated open task in the past ⇒ action_past_due, and dueAt IS that task date', () => {
    const dueAt = iso(-2)
    const state = resolveSlaState(facts({ openTasks: [{ id: 't1', dueAt }] }), DEFAULT_SLA_POLICY, NOW)
    expect(state.overdue).toBe(true)
    expect(state.overdueReason).toBe('action_past_due')
    expect(state.dueAt).toBe(dueAt)
  })

  test('a dated open task in the future ⇒ not overdue, and dueAt IS that task date (not the derived window)', () => {
    const dueAt = iso(5)
    const state = resolveSlaState(facts({ openTasks: [{ id: 't1', dueAt }] }), DEFAULT_SLA_POLICY, NOW)
    expect(state.overdue).toBe(false)
    expect(state.overdueReason).toBeNull()
    expect(state.dueAt).toBe(dueAt)
  })

  test('no dated task, inside the response window ⇒ not overdue', () => {
    // qualified: responseDays 2. Entered 1 day ago, no interaction.
    const state = resolveSlaState(facts({ stageEnteredAt: iso(-1) }), DEFAULT_SLA_POLICY, NOW)
    expect(state.overdue).toBe(false)
    expect(state.overdueReason).toBeNull()
  })

  test('no dated task, past the response window ⇒ no_dated_action', () => {
    const state = resolveSlaState(facts({ stageEnteredAt: iso(-5) }), DEFAULT_SLA_POLICY, NOW)
    expect(state.overdue).toBe(true)
    expect(state.overdueReason).toBe('no_dated_action')
  })

  test('an UNDATED open task never counts as scheduled (the shipped isMissingAction rule, imported)', () => {
    const state = resolveSlaState(
      facts({ stageEnteredAt: iso(-5), openTasks: [{ id: 't1', dueAt: null }] }),
      DEFAULT_SLA_POLICY,
      NOW,
    )
    expect(state.overdueReason).toBe('no_dated_action')
    // And it agrees with the shipped predicate by construction, not by coincidence.
    expect(pipeline.isMissingAction([{ id: 't1', dueAt: null }])).toBe(true)
  })

  test('a recent INTERACTION restarts the response clock even when the stage is old', () => {
    const stale = facts({ stageEnteredAt: iso(-9), lastInteractionAt: iso(-1) })
    const state = resolveSlaState(stale, DEFAULT_SLA_POLICY, NOW)
    // qualified stallDays is 10 and the row is 9 days in, so neither reason fires.
    expect(state.overdue).toBe(false)
  })

  test('an interaction does NOT rescue a genuinely stalled stage ⇒ stage_stalled', () => {
    // qualified: stallDays 10. Touched yesterday, a dated task due next week —
    // everything LOOKS tended, but the merchant has not moved in 20 days.
    const state = resolveSlaState(
      facts({ stageEnteredAt: iso(-20), lastInteractionAt: iso(-1), openTasks: [{ id: 't1', dueAt: iso(7) }] }),
      DEFAULT_SLA_POLICY,
      NOW,
    )
    expect(state.overdue).toBe(true)
    expect(state.overdueReason).toBe('stage_stalled')
  })

  test('precedence — a missed dated commitment outranks a stall (the more actionable reason wins)', () => {
    const state = resolveSlaState(
      facts({ stageEnteredAt: iso(-40), openTasks: [{ id: 't1', dueAt: iso(-3) }] }),
      DEFAULT_SLA_POLICY,
      NOW,
    )
    expect(state.overdueReason).toBe('action_past_due')
  })

  test('precedence — no_dated_action outranks stage_stalled', () => {
    const state = resolveSlaState(facts({ stageEnteredAt: iso(-40) }), DEFAULT_SLA_POLICY, NOW)
    expect(state.overdueReason).toBe('no_dated_action')
  })

  test('overdueReason is null if and only if overdue is false', () => {
    const cases: SlaFacts[] = [
      facts(),
      facts({ stageEnteredAt: iso(-5) }),
      facts({ openTasks: [{ id: 't', dueAt: iso(-1) }] }),
      facts({ stageEnteredAt: iso(-40), lastInteractionAt: iso(-1), openTasks: [{ id: 't', dueAt: iso(7) }] }),
    ]
    for (const f of cases) {
      const s = resolveSlaState(f, DEFAULT_SLA_POLICY, NOW)
      expect(s.overdue, JSON.stringify(f)).toBe(s.overdueReason !== null)
    }
  })

  test('ageInStageDays is the shipped ageInStageDays, not a re-derived subtraction', () => {
    const stageEnteredAt = iso(-7)
    const state = resolveSlaState(facts({ stageEnteredAt }), DEFAULT_SLA_POLICY, NOW)
    expect(state.ageInStageDays).toBe(pipeline.ageInStageDays(stageEnteredAt, NOW))
  })

  test('the row escalation target wins; the policy target is the fallback; null is null', () => {
    const withPolicyTarget: SlaPolicy = { ...DEFAULT_SLA_POLICY, escalationClerkUserId: 'user_policy' }
    expect(resolveSlaState(facts(), withPolicyTarget, NOW).escalationTarget).toBe('user_policy')
    expect(
      resolveSlaState(facts({ escalationClerkUserId: 'user_row' }), withPolicyTarget, NOW).escalationTarget,
    ).toBe('user_row')
    expect(resolveSlaState(facts(), DEFAULT_SLA_POLICY, NOW).escalationTarget).toBeNull()
  })

  test('every state carries the policy version it was computed under', () => {
    const v9: SlaPolicy = { ...DEFAULT_SLA_POLICY, version: 9 }
    expect(resolveSlaState(facts(), v9, NOW).policyVersion).toBe(9)
  })

  test('garbage timestamps never throw and never produce NaN/Invalid Date', () => {
    for (const bad of ['', 'not-a-date', '2026-13-45T99:99:99Z']) {
      const state = resolveSlaState(
        facts({ stageEnteredAt: bad, lastInteractionAt: bad }),
        DEFAULT_SLA_POLICY,
        NOW,
      )
      expect(Number.isNaN(Date.parse(state.dueAt)), bad).toBe(false)
      expect(Number.isFinite(state.ageInStageDays), bad).toBe(true)
    }
  })

  test('an unrecognized stage still gets a real deadline (defensive: the DB CHECK already prevents it)', () => {
    const state = resolveSlaState(facts({ stage: 'no_such_stage' }), DEFAULT_SLA_POLICY, NOW)
    expect(Number.isNaN(Date.parse(state.dueAt))).toBe(false)
    expect(windowForStage(DEFAULT_SLA_POLICY, 'no_such_stage')).toEqual(DEFAULT_SLA_POLICY.stages[STAGES[0]])
  })

  test('dueAt for a row with no dated task is the last touch + responseDays, in the stage window', () => {
    const stageEnteredAt = iso(-1)
    const state = resolveSlaState(facts({ stageEnteredAt }), DEFAULT_SLA_POLICY, NOW)
    const expected = new Date(Date.parse(stageEnteredAt) + DEFAULT_SLA_POLICY.stages.qualified.responseDays * DAY)
    expect(state.dueAt).toBe(expected.toISOString())
  })
})

// ── parseSlaPolicy ───────────────────────────────────────────────────────────

function validDocument(): Record<string, unknown> {
  return serializeSlaPolicy({ ...DEFAULT_SLA_POLICY, version: 7, escalationClerkUserId: 'user_esc' })
}

test.describe('parseSlaPolicy — fails CLOSED and WHOLE to the code default', () => {
  test('a valid document round-trips through serialize → parse', () => {
    const parsed = parseSlaPolicy(validDocument())
    expect(parsed).not.toBe(DEFAULT_SLA_POLICY)
    expect(parsed.version).toBe(7)
    expect(parsed.escalationClerkUserId).toBe('user_esc')
    expect(parsed.stages).toEqual(DEFAULT_SLA_POLICY.stages)
  })

  test('a rejected document returns the code default OBJECT ITSELF (so callers can tell by reference)', () => {
    expect(parseSlaPolicy(null)).toBe(DEFAULT_SLA_POLICY)
  })

  const rejected: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'policy'],
    ['an array', []],
    ['{}', {}],
    ['a missing version', { stages: validDocument().stages }],
    ['a zero version', { ...validDocument(), version: 0 }],
    ['a negative version', { ...validDocument(), version: -1 }],
    ['a non-integer version', { ...validDocument(), version: 1.5 }],
    ['a string version', { ...validDocument(), version: '3' }],
    ['a missing stages object', { version: 3 }],
    ['stages as an array', { version: 3, stages: [] }],
    ['a non-string escalation target', { ...validDocument(), escalationClerkUserId: 7 }],
  ]

  for (const [label, doc] of rejected) {
    test(`rejects ${label} → the code default, never a partial merge`, () => {
      expect(parseSlaPolicy(doc)).toBe(DEFAULT_SLA_POLICY)
    })
  }

  test('rejects a document missing ANY single stage — the population is re-derived from STAGES', () => {
    for (const stage of STAGES) {
      const doc = validDocument()
      const stages = { ...(doc.stages as Record<string, unknown>) }
      delete stages[stage]
      expect(parseSlaPolicy({ ...doc, stages }), stage).toBe(DEFAULT_SLA_POLICY)
    }
  })

  test('rejects a malformed window on ANY single stage', () => {
    const bad: unknown[] = [null, 'x', 42, {}, { responseDays: 2 }, { stallDays: 5 }, { responseDays: 0, stallDays: 5 }, { responseDays: -1, stallDays: 5 }, { responseDays: 1.5, stallDays: 5 }]
    for (const stage of STAGES) {
      for (const window of bad) {
        const doc = validDocument()
        const stages = { ...(doc.stages as Record<string, unknown>), [stage]: window }
        expect(parseSlaPolicy({ ...doc, stages }), `${stage} ${JSON.stringify(window)}`).toBe(DEFAULT_SLA_POLICY)
      }
    }
  })

  test('rejects an incoherent window where stallDays < responseDays', () => {
    const doc = validDocument()
    const stages = { ...(doc.stages as Record<string, unknown>), qualified: { responseDays: 9, stallDays: 2 } }
    expect(parseSlaPolicy({ ...doc, stages })).toBe(DEFAULT_SLA_POLICY)
  })

  test('an empty-string escalation target normalizes to null, never to ""', () => {
    expect(parseSlaPolicy({ ...validDocument(), escalationClerkUserId: '' }).escalationClerkUserId).toBeNull()
    expect(parseSlaPolicy({ ...validDocument(), escalationClerkUserId: null }).escalationClerkUserId).toBeNull()
  })

  test('serializeSlaPolicy is a positive-list builder — it CONSTRUCTS the three known keys, never deletes from a wider object', () => {
    const polluted = { ...DEFAULT_SLA_POLICY, secret: 'nope' } as unknown as SlaPolicy
    expect(Object.keys(serializeSlaPolicy(polluted)).sort()).toEqual([
      'escalationClerkUserId',
      'stages',
      'version',
    ])
    // And per stage, only the two window keys.
    const stages = serializeSlaPolicy(DEFAULT_SLA_POLICY).stages as Record<string, unknown>
    for (const stage of STAGES) {
      expect(Object.keys(stages[stage] as Record<string, unknown>).sort(), stage).toEqual(['responseDays', 'stallDays'])
    }
  })
})

// ── SLA policy version monotonicity (fresh-reviewer finding 1, PR 308) ───────
//
// `lib/portfolio/policy-server.ts` is `server-only`, so no spec can load it and
// exercise `writeSlaPolicy` directly — which is exactly why this defect shipped
// with no test that could ever have caught it. These are SOURCE-TEXT guards on
// the specific mistake, which is the strongest assertion available at this seam.
//
// THE DEFECT: `baseVersion` was `current.source === 'stored' ? current.policy.version
// : DEFAULT_SLA_POLICY.version`. Since the code default's version is 1, ANY
// non-`stored` load wrote version 2 — so one transient Supabase read error at PUT
// time rewound a row sitting at version 7 back to 2, leaving two materially
// different policies both claiming version 2 and making every
// `merchant_relationships.sla_policy_version` stamp non-comparable.

test.describe('policy-server · the version can never move backwards', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/portfolio/policy-server.ts'), 'utf8')

  test('the two unreadable cases are distinguished — a failed read is not a malformed row', () => {
    // They carry different knowledge: a failed read knows NOTHING about the
    // stored version, a malformed row knows its column. Collapsing them into one
    // `unreadable` value is what allowed the rewind.
    expect(source).toContain("'read_failed'")
    expect(source).toContain("'malformed'")
    expect(source).not.toContain("'unreadable'")
  })

  test('a failed read REFUSES the write rather than guessing a version', () => {
    expect(source).toMatch(/source === 'read_failed'/)
    // Refuses via the conflict flag the route turns into a 409 — not a
    // best-effort write, and not a 500 that would invite a blind retry loop.
    expect(source).toMatch(/conflict:\s*true/)
  })

  test('the version bump is a MAX over every version actually observed', () => {
    // Never a bare ternary onto the code default — that is the original bug.
    expect(source).toMatch(/Math\.max\(/)
    expect(source).toContain('current.rawVersion')
    expect(source).not.toMatch(/const baseVersion = current\.source === 'stored' \?/)
  })

  test('the raw version COLUMN is carried out of the load, or the max above is blind', () => {
    expect(source).toMatch(/rawVersion:\s*row\.version/)
    expect(source).toMatch(/rawVersion:\s*number \| null/)
  })

  test('the route maps the refusal to 409, not 500', () => {
    const route = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/admin/sla-policy/route.ts'),
      'utf8',
    )
    expect(route).toMatch(/written\.conflict \? 409 : 500/)
  })
})
