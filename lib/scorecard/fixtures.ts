/**
 * lib/scorecard/fixtures.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.1 — the five named
 * journey fixtures the story's acceptance names explicitly ("fixtures cover
 * zero, incomplete, corrected, retained and stale journeys"). Each returns a
 * complete `ScorecardResolverInput` (Story 1.2's pure resolver input shape)
 * so `e2e/scorecard-resolver.spec.ts` can feed it straight to
 * `resolveScorecard` with no database.
 *
 * Zero-import beyond `lib/scorecard/types.ts` and `lib/scorecard/dictionary.ts`
 * (both zero-import themselves) — loadable in the Playwright `api` project.
 */
import type {
  ScorecardResolverInput,
  ResolverRelationship,
  ResolverTransition,
  ResolverCommerceFacts,
  ResolverReconciliationRow,
} from '@/lib/scorecard/types'

export const FIXTURE_NOW = new Date('2026-07-24T12:00:00.000Z')

const DAY_MS = 24 * 60 * 60 * 1000

function iso(daysBeforeNow: number, base: Date = FIXTURE_NOW): string {
  return new Date(base.getTime() - daysBeforeNow * DAY_MS).toISOString()
}

function relationship(overrides: Partial<ResolverRelationship> & Pick<ResolverRelationship, 'id' | 'businessName' | 'stage'>): ResolverRelationship {
  return {
    stageEnteredAt: iso(0),
    createdAt: iso(0),
    cohort: 'fundadoras-2026-07',
    promoterId: null,
    stewardClerkUserId: null,
    shopId: null,
    ageInStageDays: 0,
    overdue: false,
    missingAction: true,
    ...overrides,
  }
}

const DEFAULT_THRESHOLDS = { retentionWindowDays: 30, threeProductsThreshold: 3 }

/**
 * ZERO journey — the production-reality shape this epic ships against
 * (README: "29 backfilled relationship rows all at stage `scouted`, 0
 * transitions, 0 emissions, 0 shops claimed"). Every relationship sits at
 * the baseline; nothing has ever emitted. Exercises: a non-empty cohort
 * whose funnel is ENTIRELY at ordinal 1, every later-stage metric reads
 * "missing" (never a substituted 0), and freshness reads "ok" (nothing was
 * ever supposed to emit yet).
 */
export function zeroJourneyFixture(): ScorecardResolverInput {
  const relationships: ResolverRelationship[] = [
    relationship({ id: 'r-zero-1', businessName: 'Tienda Cero Uno', stage: 'scouted', ageInStageDays: 12, createdAt: iso(12), stageEnteredAt: iso(12) }),
    relationship({ id: 'r-zero-2', businessName: 'Tienda Cero Dos', stage: 'scouted', ageInStageDays: 3, createdAt: iso(3), stageEnteredAt: iso(3) }),
  ]
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships,
    relationshipsOk: true,
    transitions: [],
    transitionsOk: true,
    commerceFacts: [],
    reconciliation: relationships.map((r): ResolverReconciliationRow => ({ relationshipId: r.id, projectedStage: r.stage, emissions: [] })),
  }
}

/**
 * INCOMPLETE journey — a relationship mid-funnel with a real, but PARTIAL,
 * transition history: it reached `claimed` (a transition row exists) but
 * has NOT reached `payments_ready`, so activation-time has one real data
 * point while later funnel stages read 0 (a GENUINE zero, not missing —
 * nobody claims to be there). Also a relationship with no shop
 * (`shopId: null`) to exercise the first-sale/retention eligibility
 * exclusion (dictionary.ts's documented exclusion rule).
 */
export function incompleteJourneyFixture(): ScorecardResolverInput {
  const relationships: ResolverRelationship[] = [
    relationship({
      id: 'r-incomplete-1',
      businessName: 'Tienda Incompleta',
      stage: 'claimed',
      createdAt: iso(20),
      stageEnteredAt: iso(5),
      ageInStageDays: 5,
      shopId: 'shop-incomplete-1',
      overdue: true,
      missingAction: false,
    }),
    relationship({ id: 'r-incomplete-2', businessName: 'Tienda Sin Tienda', stage: 'qualified', createdAt: iso(9), stageEnteredAt: iso(2), ageInStageDays: 2 }),
  ]
  const transitions: ResolverTransition[] = [
    { relationshipId: 'r-incomplete-1', toStage: 'qualified', occurredAt: iso(18) },
    { relationshipId: 'r-incomplete-1', toStage: 'permission_granted', occurredAt: iso(14) },
    { relationshipId: 'r-incomplete-1', toStage: 'claimed', occurredAt: iso(5) },
    { relationshipId: 'r-incomplete-2', toStage: 'qualified', occurredAt: iso(2) },
  ]
  const commerceFacts: ResolverCommerceFacts[] = [{ relationshipId: 'r-incomplete-1', ok: true, firstSale: false, retained30d: false }]
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships,
    relationshipsOk: true,
    transitions,
    transitionsOk: true,
    commerceFacts,
    reconciliation: relationships.map((r): ResolverReconciliationRow => ({ relationshipId: r.id, projectedStage: r.stage, emissions: [] })),
  }
}

/**
 * CORRECTED journey — an admin `correct-stage` write (README D3: "stage is
 * derived, corrections are the only writes") that moves the relationship
 * BACKWARD in calendar-time terms: the transition timeline is non-monotonic
 * in `occurred_at` vs. stage ordinal. Exercises: age-in-stage duration
 * computation must use calendar time between consecutive transitions
 * literally, never assume ordinal-monotonic ordering.
 */
export function correctedJourneyFixture(): ScorecardResolverInput {
  const relationships: ResolverRelationship[] = [
    relationship({
      id: 'r-corrected-1',
      businessName: 'Tienda Corregida',
      stage: 'preview_in_preparation',
      createdAt: iso(30),
      stageEnteredAt: iso(4),
      ageInStageDays: 4,
    }),
  ]
  const transitions: ResolverTransition[] = [
    { relationshipId: 'r-corrected-1', toStage: 'qualified', occurredAt: iso(25) },
    { relationshipId: 'r-corrected-1', toStage: 'permission_granted', occurredAt: iso(20) },
    // Correction: an admin walked the relationship BACK to preview_in_preparation
    // (a lower ordinal) 10 days ago, then it re-entered naturally.
    { relationshipId: 'r-corrected-1', toStage: 'preview_in_preparation', occurredAt: iso(10) },
    { relationshipId: 'r-corrected-1', toStage: 'preview_delivered', occurredAt: iso(6) },
    { relationshipId: 'r-corrected-1', toStage: 'preview_in_preparation', occurredAt: iso(4) },
  ]
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships,
    relationshipsOk: true,
    transitions,
    transitionsOk: true,
    commerceFacts: [],
    reconciliation: relationships.map((r): ResolverReconciliationRow => ({ relationshipId: r.id, projectedStage: r.stage, emissions: [] })),
  }
}

/**
 * RETAINED journey — a relationship that reached `retained_30d`, with a full
 * transition trail (real activation-time data point) and a commerce-fact
 * read that succeeded. Exercises the "genuine, fully-`ok`" happy path every
 * other fixture deliberately is NOT — the contrast case that proves `ok`
 * health is reachable at all.
 */
export function retainedJourneyFixture(): ScorecardResolverInput {
  const relationships: ResolverRelationship[] = [
    relationship({
      id: 'r-retained-1',
      businessName: 'Tienda Retenida',
      stage: 'retained_30d',
      createdAt: iso(90),
      stageEnteredAt: iso(10),
      ageInStageDays: 10,
      shopId: 'shop-retained-1',
      overdue: false,
      missingAction: false,
    }),
  ]
  const transitions: ResolverTransition[] = [
    { relationshipId: 'r-retained-1', toStage: 'qualified', occurredAt: iso(85) },
    { relationshipId: 'r-retained-1', toStage: 'permission_granted', occurredAt: iso(80) },
    { relationshipId: 'r-retained-1', toStage: 'preview_in_preparation', occurredAt: iso(75) },
    { relationshipId: 'r-retained-1', toStage: 'preview_delivered', occurredAt: iso(70) },
    { relationshipId: 'r-retained-1', toStage: 'activation_scheduled', occurredAt: iso(65) },
    { relationshipId: 'r-retained-1', toStage: 'claimed', occurredAt: iso(60) },
    { relationshipId: 'r-retained-1', toStage: 'payments_ready', occurredAt: iso(55) },
    { relationshipId: 'r-retained-1', toStage: 'three_products_live', occurredAt: iso(50) },
    { relationshipId: 'r-retained-1', toStage: 'shared_externally', occurredAt: iso(45) },
    { relationshipId: 'r-retained-1', toStage: 'first_inquiry', occurredAt: iso(40) },
    { relationshipId: 'r-retained-1', toStage: 'first_sale', occurredAt: iso(35) },
    { relationshipId: 'r-retained-1', toStage: 'retained_30d', occurredAt: iso(10) },
  ]
  const commerceFacts: ResolverCommerceFacts[] = [{ relationshipId: 'r-retained-1', ok: true, firstSale: true, retained30d: true }]
  const reconciliation: ResolverReconciliationRow[] = [
    {
      relationshipId: 'r-retained-1',
      projectedStage: 'retained_30d',
      emissions: [
        { eventType: 'merchant.claimed', deliveredAt: iso(60) },
        { eventType: 'merchant.first_sale', deliveredAt: iso(35) },
        { eventType: 'merchant.retained_30d', deliveredAt: iso(9) },
      ],
    },
  ]
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships,
    relationshipsOk: true,
    transitions,
    transitionsOk: true,
    commerceFacts,
    reconciliation,
  }
}

/**
 * STALE journey — TWO distinct kinds of staleness in one fixture, kept
 * separate so a spec can assert each independently:
 *   - `r-stale-emission`: reached `claimed` with NO delivered Golden Beans
 *     emission for it — the SD1 freshness diagnostic must flag this
 *     relationship without touching its (correct) canonical stage.
 *   - `r-stale-read`: its commerce-facts read FAILED (`ok: false`) — must
 *     exclude it from first-sale/retention rather than reading "no sale".
 * A THIRD relationship (`r-stale-noread`) has `transitionsOk: false` at the
 * whole-input level (SD4: a read failure degrades the WHOLE aging/
 * activation-time computation to `stale`, not just one row).
 */
export function staleJourneyFixture(): ScorecardResolverInput {
  const relationships: ResolverRelationship[] = [
    relationship({
      id: 'r-stale-emission',
      businessName: 'Tienda Sin Emisión',
      stage: 'claimed',
      createdAt: iso(15),
      stageEnteredAt: iso(3),
      ageInStageDays: 3,
      shopId: 'shop-stale-emission',
    }),
    relationship({
      id: 'r-stale-read',
      businessName: 'Tienda Lectura Fallida',
      stage: 'claimed',
      createdAt: iso(20),
      stageEnteredAt: iso(6),
      ageInStageDays: 6,
      shopId: 'shop-stale-read',
    }),
  ]
  const transitions: ResolverTransition[] = [
    { relationshipId: 'r-stale-emission', toStage: 'qualified', occurredAt: iso(12) },
    { relationshipId: 'r-stale-emission', toStage: 'claimed', occurredAt: iso(3) },
    { relationshipId: 'r-stale-read', toStage: 'qualified', occurredAt: iso(16) },
    { relationshipId: 'r-stale-read', toStage: 'claimed', occurredAt: iso(6) },
  ]
  const commerceFacts: ResolverCommerceFacts[] = [
    { relationshipId: 'r-stale-emission', ok: true, firstSale: false, retained30d: false },
    { relationshipId: 'r-stale-read', ok: false },
  ]
  const reconciliation: ResolverReconciliationRow[] = [
    { relationshipId: 'r-stale-emission', projectedStage: 'claimed', emissions: [] },
    { relationshipId: 'r-stale-read', projectedStage: 'claimed', emissions: [{ eventType: 'merchant.claimed', deliveredAt: iso(6) }] },
  ]
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships,
    relationshipsOk: true,
    transitions,
    transitionsOk: true,
    commerceFacts,
    reconciliation,
  }
}

/** A whole-input failure — `listAllRelationships`/`enrichRelationships`
 *  itself returned `{ ok: false }`. Every metric must degrade to `missing`,
 *  never read the (necessarily empty) `relationships` array as a real zero
 *  cohort. */
export function relationshipsReadFailedFixture(): ScorecardResolverInput {
  return {
    now: FIXTURE_NOW,
    filters: {},
    thresholds: DEFAULT_THRESHOLDS,
    relationships: [],
    relationshipsOk: false,
    transitions: [],
    transitionsOk: false,
    commerceFacts: [],
    reconciliation: [],
  }
}

export const ALL_FIXTURES = {
  zero: zeroJourneyFixture,
  incomplete: incompleteJourneyFixture,
  corrected: correctedJourneyFixture,
  retained: retainedJourneyFixture,
  stale: staleJourneyFixture,
  relationshipsReadFailed: relationshipsReadFailedFixture,
} as const
