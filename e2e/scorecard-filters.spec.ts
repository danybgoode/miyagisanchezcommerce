import { expect, test } from '@playwright/test'
import { applyScorecardFilters } from '../lib/scorecard/filters'
import type { ResolverRelationship } from '../lib/scorecard/types'
import { resolveScorecard } from '../lib/scorecard/resolver'
import { incompleteJourneyFixture } from '../lib/scorecard/fixtures'

/**
 * Merchant activation scorecard · Sprint 1, Story 1.2 (api project,
 * network-free): filter-combination coverage for `applyScorecardFilters`.
 * `stage`/`steward` are ALSO pushed down to SQL by the impure loader; this
 * spec exercises the SAME predicate with no database, per Sprint QA
 * ("filter combinations").
 */

function rel(overrides: Partial<ResolverRelationship> & Pick<ResolverRelationship, 'id'>): ResolverRelationship {
  return {
    businessName: overrides.id,
    stage: 'scouted',
    stageEnteredAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    cohort: null,
    promoterId: null,
    stewardClerkUserId: null,
    shopId: null,
    ageInStageDays: 0,
    overdue: false,
    missingAction: false,
    ...overrides,
  }
}

const ROWS: ResolverRelationship[] = [
  rel({ id: 'a', cohort: 'fundadoras-2026-07', stage: 'scouted', promoterId: 'p1', stewardClerkUserId: 'u1', createdAt: '2026-07-01T00:00:00.000Z' }),
  rel({ id: 'b', cohort: 'fundadoras-2026-07', stage: 'claimed', promoterId: 'p2', stewardClerkUserId: 'u2', createdAt: '2026-07-10T00:00:00.000Z' }),
  rel({ id: 'c', cohort: 'fundadoras-2026-08', stage: 'scouted', promoterId: 'p1', stewardClerkUserId: 'u1', createdAt: '2026-08-01T00:00:00.000Z' }),
]

test.describe('applyScorecardFilters — single filters', () => {
  test('no filters → every row passes through', () => {
    expect(applyScorecardFilters(ROWS, {})).toHaveLength(3)
  })

  test('cohort filters to an exact match', () => {
    expect(applyScorecardFilters(ROWS, { cohort: 'fundadoras-2026-07' }).map((r) => r.id)).toEqual(['a', 'b'])
  })

  test('stage filters to an exact match', () => {
    expect(applyScorecardFilters(ROWS, { stage: 'claimed' }).map((r) => r.id)).toEqual(['b'])
  })

  test('promoter filters to an exact promoterId match', () => {
    expect(applyScorecardFilters(ROWS, { promoter: 'p2' }).map((r) => r.id)).toEqual(['b'])
  })

  test('steward filters to an exact stewardClerkUserId match', () => {
    expect(applyScorecardFilters(ROWS, { steward: 'u1' }).map((r) => r.id)).toEqual(['a', 'c'])
  })

  test('dateFrom/dateTo bound createdAt inclusively', () => {
    expect(applyScorecardFilters(ROWS, { dateFrom: '2026-07-05T00:00:00.000Z' }).map((r) => r.id)).toEqual(['b', 'c'])
    expect(applyScorecardFilters(ROWS, { dateTo: '2026-07-10T00:00:00.000Z' }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(applyScorecardFilters(ROWS, { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-31T23:59:59.999Z' }).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

test.describe('applyScorecardFilters — combinations narrow AND-wise, never OR-wise', () => {
  test('cohort + steward together only match rows satisfying BOTH', () => {
    expect(applyScorecardFilters(ROWS, { cohort: 'fundadoras-2026-07', steward: 'u1' }).map((r) => r.id)).toEqual(['a'])
  })

  test('a combination matching nothing returns an empty array, not an error', () => {
    expect(applyScorecardFilters(ROWS, { cohort: 'fundadoras-2026-07', stage: 'retained_30d' })).toEqual([])
  })

  test('all six filters combined narrow to exactly the intersection', () => {
    const result = applyScorecardFilters(ROWS, {
      cohort: 'fundadoras-2026-07',
      stage: 'scouted',
      promoter: 'p1',
      steward: 'u1',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-07-31T00:00:00.000Z',
    })
    expect(result.map((r) => r.id)).toEqual(['a'])
  })
})

test.describe('the resolver applies filters before computing metrics — a filtered-out relationship never contributes', () => {
  test('filtering to a single stage collapses the cohort AND the funnel to that population', () => {
    const input = incompleteJourneyFixture()
    input.filters = { stage: 'qualified' }
    const scorecard = resolveScorecard(input)
    expect(scorecard.summary.cohortEntry.value).toBe(1)
    expect(scorecard.funnel.find((f) => f.stage === 'scouted')!.count.value).toBe(1)
    expect(scorecard.funnel.find((f) => f.stage === 'claimed')!.count.value).toBe(0)
  })

  test('the returned scorecard echoes the filters it was resolved with', () => {
    const input = incompleteJourneyFixture()
    input.filters = { cohort: 'fundadoras-2026-07' }
    const scorecard = resolveScorecard(input)
    expect(scorecard.filters).toEqual({ cohort: 'fundadoras-2026-07' })
  })
})
