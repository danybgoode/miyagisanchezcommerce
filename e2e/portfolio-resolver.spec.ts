import { expect, test } from '@playwright/test'
import { STAGES } from '../lib/merchant-stage'
import { STAGE_LABEL } from '../lib/merchant-stage-labels'
import { DEFAULT_SLA_POLICY, resolveSlaState, type SlaState } from '../lib/portfolio/sla'
import {
  PORTFOLIO_DUE_SOON_DAYS,
  PREFERRED_CHANNEL_LABEL,
  applyPortfolioFilters,
  buildPortfolioRow,
  comparePortfolioRows,
  deriveDueState,
  needsAction,
  orderPortfolioRows,
  parsePortfolioFilters,
  resolvePortfolio,
  summarizePortfolio,
  type PortfolioDueState,
  type PortfolioInputRow,
  type PortfolioRow,
} from '../lib/portfolio/resolver'

/**
 * Merchant Partner lifecycle · Sprint 1, Story 1.2 (api project, network-free):
 * the pure half of the partner work queue — the SAFE row DTO, the filter parser,
 * the filter predicate, the TOTAL ordering and the summary counts.
 * `lib/portfolio/resolver.ts` is zero-import beyond three zero-import modules,
 * so everything below runs with no database, no Clerk, no Next.
 *
 * The load-bearing assertions here are the two the acceptance actually turns on:
 *
 *   1. THE LIST NEVER CARRIES A CONTACT VALUE. Fed a fully-populated row, the
 *      serialized DTO contains none of the four raw contact fields' values.
 *      Proven against the SERIALIZED JSON (not a key list), so a value smuggled
 *      into a nested object or a differently-named field is still caught.
 *   2. THE ORDERING IS TOTAL. A shuffled fixture ordered twice from different
 *      starting permutations produces an identical sequence — the invariant
 *      LEARNINGS records a real scorecard bug for violating.
 *
 * RED-OBSERVED (red-green DoD): see the PR body.
 */

const NOW = new Date('2026-07-24T18:00:00.000Z')
const DAY = 86_400_000

function iso(offsetDays: number): string {
  return new Date(NOW.getTime() + offsetDays * DAY).toISOString()
}

function sla(over: Partial<SlaState> = {}): SlaState {
  return {
    dueAt: iso(3),
    overdue: false,
    overdueReason: null,
    ageInStageDays: 1,
    escalationTarget: null,
    policyVersion: DEFAULT_SLA_POLICY.version,
    ...over,
  }
}

function input(over: Partial<PortfolioInputRow> = {}): PortfolioInputRow {
  return {
    id: 'r-1',
    businessName: 'Café Don Memo',
    contactName: 'Guillermo',
    estado: 'Jalisco',
    municipio: 'Guadalajara',
    category: 'cafetería',
    stage: 'qualified',
    stageEnteredAt: iso(-1),
    createdAt: iso(-10),
    preferredChannel: 'whatsapp',
    stewardClerkUserId: 'user_steward',
    assignmentReason: null,
    assignedAt: null,
    ageInStageDays: 1,
    nextAction: { id: 't-1', dueAt: iso(5) },
    missingAction: false,
    blocker: false,
    consentState: 'sin_vista_previa',
    openTaskCount: 1,
    lastInteractionAt: iso(-1),
    sla: sla(),
    ...over,
  }
}

function row(over: Partial<PortfolioRow> = {}, inputOver: Partial<PortfolioInputRow> = {}): PortfolioRow {
  return { ...buildPortfolioRow(input(inputOver), NOW), ...over }
}

// ── 1. Safe-only contact data ────────────────────────────────────────────────

test.describe('the list DTO is SAFE-ONLY — no raw contact value can reach it', () => {
  // The four raw columns the build contract names. Values chosen to be
  // unmistakable in a JSON blob.
  const SECRETS = {
    phone: '+5213330001111',
    email: 'memo@cafedonmemo.mx',
    whatsapp: '+5213330002222',
    instagram: '@cafedonmemo',
  }

  test('PortfolioInputRow has no field that could carry a contact value in the first place', () => {
    // The input type is the boundary: if it cannot ACCEPT a contact value, no
    // amount of DTO carelessness can leak one. Asserted by construction — a
    // fully-populated input is built from the exported type, and any attempt to
    // add `phone`/`email`/`whatsapp`/`instagramHandle` to it fails `tsc`.
    const keys = Object.keys(input())
    for (const banned of ['phone', 'phoneE164', 'email', 'emailNormalized', 'whatsapp', 'whatsappE164', 'instagramHandle']) {
      expect(keys, banned).not.toContain(banned)
    }
  })

  test('a row polluted with contact values still serializes without any of them', () => {
    // Force the values in past the type system, exactly as a careless upstream
    // spread would, and prove the positive-list builder drops them.
    const polluted = { ...input(), ...SECRETS, phone_e164: SECRETS.phone, email_normalized: SECRETS.email } as unknown as PortfolioInputRow
    const serialized = JSON.stringify(buildPortfolioRow(polluted, NOW))
    for (const [label, value] of Object.entries(SECRETS)) {
      expect(serialized.includes(value), label).toBe(false)
    }
  })

  test('a whole resolved portfolio serializes without any contact value', () => {
    const polluted = { ...input(), ...SECRETS } as unknown as PortfolioInputRow
    const portfolio = resolvePortfolio([polluted], { view: 'all' }, DEFAULT_SLA_POLICY.version, NOW)
    const serialized = JSON.stringify(portfolio)
    for (const value of Object.values(SECRETS)) {
      expect(serialized.includes(value)).toBe(false)
    }
  })

  test('preferredChannel is the es-MX LABEL, never the raw enum value', () => {
    for (const [raw, label] of Object.entries(PREFERRED_CHANNEL_LABEL)) {
      const built = buildPortfolioRow(input({ preferredChannel: raw }), NOW)
      expect(built.preferredChannel, raw).toBe(label)
      expect(built.preferredChannel, raw).not.toBe(raw)
    }
  })

  test('an unknown or absent preferred channel is null, never a leaked raw string', () => {
    expect(buildPortfolioRow(input({ preferredChannel: null }), NOW).preferredChannel).toBeNull()
    expect(buildPortfolioRow(input({ preferredChannel: 'carrier_pigeon' }), NOW).preferredChannel).toBeNull()
    // A prototype key must not read as a known channel.
    expect(buildPortfolioRow(input({ preferredChannel: 'toString' }), NOW).preferredChannel).toBeNull()
  })

  test('every DB-CHECK channel value has a label (the population is the five known values)', () => {
    expect(Object.keys(PREFERRED_CHANNEL_LABEL).sort()).toEqual(['email', 'in_person', 'instagram', 'phone', 'whatsapp'])
  })
})

// ── 2. dueState ──────────────────────────────────────────────────────────────

test.describe('deriveDueState — four states, overdue always wins', () => {
  test('an overdue SLA state ⇒ overdue, even when nothing is scheduled', () => {
    const state = deriveDueState({ sla: sla({ overdue: true, overdueReason: 'no_dated_action' }), missingAction: true, nextAction: null }, NOW)
    expect(state).toBe('overdue')
  })

  test('not overdue and nothing dated ⇒ missing', () => {
    expect(deriveDueState({ sla: sla(), missingAction: true, nextAction: null }, NOW)).toBe('missing')
  })

  test('a dated action inside the due-soon window ⇒ due_soon', () => {
    const dueAt = iso(PORTFOLIO_DUE_SOON_DAYS - 0.5)
    expect(deriveDueState({ sla: sla(), missingAction: false, nextAction: { id: 't', dueAt } }, NOW)).toBe('due_soon')
  })

  test('a dated action beyond the due-soon window ⇒ scheduled', () => {
    const dueAt = iso(PORTFOLIO_DUE_SOON_DAYS + 1)
    expect(deriveDueState({ sla: sla(), missingAction: false, nextAction: { id: 't', dueAt } }, NOW)).toBe('scheduled')
  })

  test('an unparseable next-action date degrades to missing, never to scheduled', () => {
    expect(deriveDueState({ sla: sla(), missingAction: false, nextAction: { id: 't', dueAt: 'not-a-date' } }, NOW)).toBe('missing')
    expect(deriveDueState({ sla: sla(), missingAction: false, nextAction: { id: 't', dueAt: null } }, NOW)).toBe('missing')
  })

  test('the four states are exhaustive over the (overdue × missing × dated) space', () => {
    const seen = new Set<PortfolioDueState>()
    for (const overdue of [true, false]) {
      for (const missingAction of [true, false]) {
        for (const dueAt of [null, iso(1), iso(9)]) {
          seen.add(
            deriveDueState(
              { sla: sla({ overdue, overdueReason: overdue ? 'stage_stalled' : null }), missingAction, nextAction: dueAt ? { id: 't', dueAt } : null },
              NOW,
            ),
          )
        }
      }
    }
    expect([...seen].sort()).toEqual(['due_soon', 'missing', 'overdue', 'scheduled'])
  })
})

// ── 3. Filters ───────────────────────────────────────────────────────────────

test.describe('parsePortfolioFilters — the default is an ACTION QUEUE, and garbage is dropped', () => {
  const parse = (qs: string) => parsePortfolioFilters(new URLSearchParams(qs))

  test('no params ⇒ view=needs_action and no other filter', () => {
    expect(parse('')).toEqual({ view: 'needs_action', stage: undefined, blocker: undefined, dueState: undefined })
  })

  test('view=all is the explicit opt-out; any other value falls back to needs_action', () => {
    expect(parse('view=all').view).toBe('all')
    for (const v of ['', 'ALL', 'todos', 'needs_action', 'nonsense']) {
      expect(parse(`view=${v}`).view, v).toBe('needs_action')
    }
  })

  test('stage is validated against the canonical STAGES, never a local list', () => {
    for (const stage of STAGES) {
      expect(parse(`stage=${stage}`).stage, stage).toBe(stage)
    }
    for (const bad of ['', 'permission_received', 'CLAIMED', 'toString', 'nope']) {
      expect(parse(`stage=${bad}`).stage, bad).toBeUndefined()
    }
  })

  test('blocker parses only the two explicit booleans; anything else is "no filter"', () => {
    expect(parse('blocker=true').blocker).toBe(true)
    expect(parse('blocker=false').blocker).toBe(false)
    for (const bad of ['', '1', '0', 'yes', 'TRUE']) {
      expect(parse(`blocker=${bad}`).blocker, bad).toBeUndefined()
    }
  })

  test('due parses only the four known states', () => {
    for (const s of ['overdue', 'due_soon', 'scheduled', 'missing']) {
      expect(parse(`due=${s}`).dueState, s).toBe(s)
    }
    for (const bad of ['', 'late', 'OVERDUE', 'toString']) {
      expect(parse(`due=${bad}`).dueState, bad).toBeUndefined()
    }
  })
})

test.describe('applyPortfolioFilters — every branch', () => {
  const overdueRow = row({ id: 'a', dueState: 'overdue', slaOverdue: true, missingAction: false, blocker: false, stage: 'qualified' })
  const missingRow = row({ id: 'b', dueState: 'missing', slaOverdue: false, missingAction: true, blocker: false, stage: 'claimed' })
  const scheduledRow = row({ id: 'c', dueState: 'scheduled', slaOverdue: false, missingAction: false, blocker: false, stage: 'claimed' })
  const dueSoonRow = row({ id: 'd', dueState: 'due_soon', slaOverdue: false, missingAction: false, blocker: false, stage: 'scouted' })
  const blockedScheduledRow = row({ id: 'e', dueState: 'scheduled', slaOverdue: false, missingAction: false, blocker: true, stage: 'claimed' })
  const all = [overdueRow, missingRow, scheduledRow, dueSoonRow, blockedScheduledRow]

  test('needs_action keeps overdue, missing and blocked rows — and nothing else', () => {
    const ids = applyPortfolioFilters(all, { view: 'needs_action' }).map((r) => r.id)
    expect(ids.sort()).toEqual(['a', 'b', 'e'])
  })

  test('a tended, unblocked row is NOT in the action queue', () => {
    expect(needsAction(scheduledRow)).toBe(false)
    expect(needsAction(dueSoonRow)).toBe(false)
  })

  test('view=all keeps everything', () => {
    expect(applyPortfolioFilters(all, { view: 'all' })).toHaveLength(5)
  })

  test('stage filter', () => {
    expect(applyPortfolioFilters(all, { view: 'all', stage: 'claimed' }).map((r) => r.id).sort()).toEqual(['b', 'c', 'e'])
  })

  test('blocker=true and blocker=false are both real filters (false is not "no filter")', () => {
    expect(applyPortfolioFilters(all, { view: 'all', blocker: true }).map((r) => r.id)).toEqual(['e'])
    expect(applyPortfolioFilters(all, { view: 'all', blocker: false }).map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  test('dueState filter, all four values', () => {
    expect(applyPortfolioFilters(all, { view: 'all', dueState: 'overdue' }).map((r) => r.id)).toEqual(['a'])
    expect(applyPortfolioFilters(all, { view: 'all', dueState: 'missing' }).map((r) => r.id)).toEqual(['b'])
    expect(applyPortfolioFilters(all, { view: 'all', dueState: 'due_soon' }).map((r) => r.id)).toEqual(['d'])
    expect(applyPortfolioFilters(all, { view: 'all', dueState: 'scheduled' }).map((r) => r.id).sort()).toEqual(['c', 'e'])
  })

  test('filters compose (stage AND blocker AND dueState)', () => {
    expect(
      applyPortfolioFilters(all, { view: 'all', stage: 'claimed', blocker: true, dueState: 'scheduled' }).map((r) => r.id),
    ).toEqual(['e'])
  })

  test('never mutates the input array', () => {
    const snapshot = all.map((r) => r.id)
    applyPortfolioFilters(all, { view: 'needs_action', stage: 'claimed' })
    expect(all.map((r) => r.id)).toEqual(snapshot)
  })
})

// ── 4. Ordering ──────────────────────────────────────────────────────────────

test.describe('ordering is TOTAL — overdue first, then missing, then next-action, then createdAt, then id', () => {
  const createdAt = new Map<string, string>()
  function make(id: string, over: Partial<PortfolioRow>, created = iso(-10)): PortfolioRow {
    createdAt.set(id, created)
    return row({ id, ...over })
  }

  const veryOverdue = make('very-overdue', { slaOverdue: true, dueState: 'overdue', slaDueAt: iso(-9), missingAction: false })
  const slightlyOverdue = make('slightly-overdue', { slaOverdue: true, dueState: 'overdue', slaDueAt: iso(-1), missingAction: false })
  const stalled = make('stalled', { slaOverdue: true, dueState: 'overdue', slaDueAt: iso(6), slaOverdueReason: 'stage_stalled', missingAction: false })
  const missingA = make('missing-a', { slaOverdue: false, dueState: 'missing', missingAction: true, slaDueAt: iso(1) })
  const missingB = make('missing-b', { slaOverdue: false, dueState: 'missing', missingAction: true, slaDueAt: iso(4) })
  const soon = make('soon', { slaOverdue: false, dueState: 'due_soon', missingAction: false, nextActionDueAt: iso(1) })
  const later = make('later', { slaOverdue: false, dueState: 'scheduled', missingAction: false, nextActionDueAt: iso(20) })

  const shuffled = [later, missingB, stalled, soon, veryOverdue, missingA, slightlyOverdue]

  test('bands: every overdue row precedes every missing row, which precedes every tended row', () => {
    const ordered = orderPortfolioRows(shuffled, createdAt).map((r) => r.id)
    expect(ordered).toEqual([
      'very-overdue',
      'slightly-overdue',
      'stalled',
      'missing-a',
      'missing-b',
      'soon',
      'later',
    ])
  })

  test('most overdue first — a missed dated commitment outranks a merely stalled stage', () => {
    const ordered = orderPortfolioRows([stalled, veryOverdue], createdAt).map((r) => r.id)
    expect(ordered).toEqual(['very-overdue', 'stalled'])
  })

  test('createdAt DESC breaks a tie before id does', () => {
    const tieCreated = new Map<string, string>()
    const older = row({ id: 'zzz-older', slaOverdue: false, dueState: 'scheduled', missingAction: false, nextActionDueAt: iso(5) })
    const newer = row({ id: 'aaa-newer', slaOverdue: false, dueState: 'scheduled', missingAction: false, nextActionDueAt: iso(5) })
    tieCreated.set(older.id, iso(-30))
    tieCreated.set(newer.id, iso(-1))
    // Newest first, even though its id sorts earlier — proves createdAt is
    // consulted BEFORE the id tiebreak, not after.
    expect(orderPortfolioRows([older, newer], tieCreated).map((r) => r.id)).toEqual(['aaa-newer', 'zzz-older'])
  })

  test('id ASC is the FINAL tiebreak, so the comparator never returns 0 for two distinct rows', () => {
    const sameCreated = new Map<string, string>()
    const a = row({ id: 'id-a', slaOverdue: false, dueState: 'scheduled', missingAction: false, nextActionDueAt: iso(5) })
    const b = row({ id: 'id-b', slaOverdue: false, dueState: 'scheduled', missingAction: false, nextActionDueAt: iso(5) })
    sameCreated.set('id-a', iso(-5))
    sameCreated.set('id-b', iso(-5))
    expect(comparePortfolioRows(a, b, sameCreated)).toBeLessThan(0)
    expect(comparePortfolioRows(b, a, sameCreated)).toBeGreaterThan(0)
    expect(comparePortfolioRows(a, a, sameCreated)).toBe(0)
  })

  test('TOTALITY: two different input permutations produce the identical sequence', () => {
    const forwards = orderPortfolioRows(shuffled, createdAt).map((r) => r.id)
    const backwards = orderPortfolioRows([...shuffled].reverse(), createdAt).map((r) => r.id)
    const rotated = orderPortfolioRows([...shuffled.slice(3), ...shuffled.slice(0, 3)], createdAt).map((r) => r.id)
    expect(backwards).toEqual(forwards)
    expect(rotated).toEqual(forwards)
  })

  test('a row with an unknown createdAt still orders deterministically (no NaN comparison)', () => {
    const empty = new Map<string, string>()
    const ordered = orderPortfolioRows(shuffled, empty).map((r) => r.id)
    expect(orderPortfolioRows([...shuffled].reverse(), empty).map((r) => r.id)).toEqual(ordered)
  })

  test('never mutates the input array', () => {
    const snapshot = shuffled.map((r) => r.id)
    orderPortfolioRows(shuffled, createdAt)
    expect(shuffled.map((r) => r.id)).toEqual(snapshot)
  })
})

// ── 5. Summary + end-to-end pure pipeline ────────────────────────────────────

test.describe('summary counts are computed over the UNFILTERED population', () => {
  test('a filtered view still reports the true total, so "5 de 29" is honest', () => {
    const inputs = [
      input({ id: 'i-overdue', sla: sla({ overdue: true, overdueReason: 'action_past_due' }), nextAction: { id: 't', dueAt: iso(-2) } }),
      input({ id: 'i-missing', missingAction: true, nextAction: null }),
      input({ id: 'i-scheduled', nextAction: { id: 't', dueAt: iso(30) } }),
      input({ id: 'i-blocked', blocker: true, nextAction: { id: 't', dueAt: iso(30) } }),
    ]
    const portfolio = resolvePortfolio(inputs, { view: 'needs_action' }, 1, NOW)
    expect(portfolio.summary.total).toBe(4)
    expect(portfolio.summary.overdue).toBe(1)
    expect(portfolio.summary.missing).toBe(1)
    expect(portfolio.summary.scheduled).toBe(2)
    expect(portfolio.summary.blocked).toBe(1)
    expect(portfolio.summary.needsAction).toBe(3)
    // …while the RENDERED rows are only the three that need action.
    expect(portfolio.rows.map((r) => r.id).sort()).toEqual(['i-blocked', 'i-missing', 'i-overdue'])
  })

  test('an empty portfolio summarizes to all zeros, never to NaN', () => {
    const s = summarizePortfolio([])
    for (const value of Object.values(s)) expect(Number.isFinite(value)).toBe(true)
    expect(s.total).toBe(0)
  })

  test('resolvePortfolio echoes the policy version and the generation instant', () => {
    const portfolio = resolvePortfolio([input()], { view: 'all' }, 7, NOW)
    expect(portfolio.slaPolicyVersion).toBe(7)
    expect(portfolio.generatedAt).toBe(NOW.toISOString())
  })
})

test.describe('the SLA layer and the DTO agree by construction', () => {
  test('a row built from a real resolveSlaState carries that state verbatim', () => {
    const openTasks = [{ id: 't-1', dueAt: iso(-3) }]
    const state = resolveSlaState(
      { stage: 'qualified', stageEnteredAt: iso(-4), openTasks, lastInteractionAt: null, escalationClerkUserId: 'user_esc' },
      DEFAULT_SLA_POLICY,
      NOW,
    )
    const built = buildPortfolioRow(input({ sla: state, nextAction: openTasks[0], missingAction: false }), NOW)
    expect(built.slaOverdue).toBe(state.overdue)
    expect(built.slaOverdueReason).toBe(state.overdueReason)
    expect(built.slaDueAt).toBe(state.dueAt)
    expect(built.escalationTarget).toBe('user_esc')
    expect(built.dueState).toBe('overdue')
  })

  test('stageOrdinal comes from the canonical STAGE_ORDINAL, and an unknown stage is 0 (never a guess)', () => {
    STAGES.forEach((stage, i) => {
      expect(buildPortfolioRow(input({ stage }), NOW).stageOrdinal, stage).toBe(i + 1)
    })
    expect(buildPortfolioRow(input({ stage: 'no_such_stage' }), NOW).stageOrdinal).toBe(0)
  })
})

test.describe('stage labels — one definition, es-MX complete', () => {
  test('every canonical stage has an es-MX label (no raw English slug can reach a Spanish-only surface)', () => {
    for (const stage of STAGES) {
      expect(STAGE_LABEL[stage], stage).toBeTruthy()
      expect(STAGE_LABEL[stage], stage).not.toBe(stage)
    }
  })

  test('the label map covers exactly the canonical stages — no orphan, no gap', () => {
    expect(Object.keys(STAGE_LABEL).sort()).toEqual([...STAGES].sort())
  })
})
