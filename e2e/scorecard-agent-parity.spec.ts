import { expect, test } from '@playwright/test'
import { resolveScorecard } from '../lib/scorecard/resolver'
import { boundScorecard } from '../lib/scorecard/bound'
import { SCORECARD_TOOL_DEFINITION, SCORECARD_TOOL_NAME, DEFAULT_MAX_IDS, parseScorecardMcpFilters, clampMaxIds } from '../lib/scorecard/mcp-tool'
import { retainedJourneyFixture, incompleteJourneyFixture, zeroJourneyFixture } from '../lib/scorecard/fixtures'

/**
 * Merchant activation scorecard · Sprint 2, Story 2.3 (api project,
 * network-free): "UI/API/agent fixture comparisons agree". The UI (Story
 * 2.1) and the read endpoint (Story 1.3) render `loadScorecard`'s output
 * directly with no transform — so their agreement is true by construction.
 * The agent tool additionally BOUNDS the drill-through id arrays
 * (`lib/scorecard/bound.ts`); this spec is what proves that bounding is the
 * ONLY difference — every count, ratio and health stays byte-identical
 * between the unbounded (UI/API) and bounded (agent) view of the SAME
 * resolver output.
 */

test.describe('boundScorecard never changes a metric value or health — only id-list length', () => {
  test('summary metric values/health are byte-identical before and after bounding', () => {
    const scorecard = resolveScorecard(retainedJourneyFixture())
    const bounded = boundScorecard(scorecard, 1)

    expect(bounded.summary.cohortEntry).toEqual(scorecard.summary.cohortEntry)
    expect(bounded.summary.overdueCount).toEqual(scorecard.summary.overdueCount)
    expect(bounded.summary.missingActionCount).toEqual(scorecard.summary.missingActionCount)
    expect(bounded.summary.activationTimeMedianDays).toEqual(scorecard.summary.activationTimeMedianDays)
    expect(bounded.summary.firstSaleCount).toEqual(scorecard.summary.firstSaleCount)
    expect(bounded.summary.firstSaleRate).toEqual(scorecard.summary.firstSaleRate)
    expect(bounded.summary.retained30dCount).toEqual(scorecard.summary.retained30dCount)
    expect(bounded.freshness).toEqual(scorecard.freshness)
  })

  test('funnel count/conversion/aging values are byte-identical before and after bounding', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    const bounded = boundScorecard(scorecard, 0) // maximally aggressive bound

    expect(bounded.funnel.map((f) => f.count)).toEqual(scorecard.funnel.map((f) => f.count))
    expect(bounded.funnel.map((f) => f.conversionFromPrevious)).toEqual(scorecard.funnel.map((f) => f.conversionFromPrevious))
    expect(bounded.funnel.map((f) => f.agingMedianDays)).toEqual(scorecard.funnel.map((f) => f.agingMedianDays))
  })

  test('a small maxIds truncates the id list but reports the TRUE total, never silently drops it', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    const bounded = boundScorecard(scorecard, 0)
    const claimedFunnel = bounded.funnel.find((f) => f.stage === 'claimed')!
    const rawClaimed = scorecard.funnel.find((f) => f.stage === 'claimed')!
    expect(claimedFunnel.drillThroughIds.ids).toEqual([])
    expect(claimedFunnel.drillThroughIds.total).toBe(rawClaimed.drillThroughIds.length)
    expect(claimedFunnel.drillThroughIds.truncated).toBe(rawClaimed.drillThroughIds.length > 0)
  })

  test('a maxIds at least as large as the population never truncates', () => {
    const scorecard = resolveScorecard(retainedJourneyFixture())
    const bounded = boundScorecard(scorecard, 1000)
    expect(bounded.summary.firstSaleIds).toEqual({ ids: scorecard.summary.firstSaleIds, total: scorecard.summary.firstSaleIds.length, truncated: false })
  })

  test('bounding an empty (zero journey) cohort produces empty-but-consistent lists, not an error', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    const bounded = boundScorecard(scorecard, DEFAULT_MAX_IDS)
    expect(bounded.summary.firstSaleIds).toEqual({ ids: [], total: 0, truncated: false })
  })
})

test.describe('the tool definition mirrors the SAME filter set the read endpoint and CSV export accept', () => {
  test('tool name is the documented get_activation_scorecard', () => {
    expect(SCORECARD_TOOL_NAME).toBe('get_activation_scorecard')
  })

  test('input schema names cohort/stage/promoter/steward/date_from/date_to — the six ScorecardFilters fields', () => {
    const props = Object.keys(SCORECARD_TOOL_DEFINITION.inputSchema.properties)
    expect(props.sort()).toEqual(['cohort', 'date_from', 'date_to', 'max_ids', 'promoter', 'stage', 'steward'].sort())
  })

  test('the schema forbids additional properties — an agent cannot smuggle an unrecognised filter through', () => {
    expect(SCORECARD_TOOL_DEFINITION.inputSchema.additionalProperties).toBe(false)
  })

  test('parseScorecardMcpFilters maps the tool arguments to the SAME ScorecardFilters shape the endpoint parses', () => {
    const filters = parseScorecardMcpFilters({ cohort: 'fundadoras-2026-07', stage: 'claimed', date_from: '2026-07-01' })
    expect(filters).toEqual({ cohort: 'fundadoras-2026-07', stage: 'claimed', promoter: undefined, steward: undefined, dateFrom: '2026-07-01', dateTo: undefined })
  })

  test('parseScorecardMcpFilters ignores non-string / empty-string arguments rather than passing them through', () => {
    const filters = parseScorecardMcpFilters({ cohort: 42, stage: '', steward: null })
    expect(filters).toEqual({ cohort: undefined, stage: undefined, promoter: undefined, steward: undefined, dateFrom: undefined, dateTo: undefined })
  })
})

test.describe('clampMaxIds — bounded/paginated, never 0 and never unbounded', () => {
  test('a missing/non-numeric max_ids falls back to the default', () => {
    expect(clampMaxIds(undefined)).toBe(DEFAULT_MAX_IDS)
    expect(clampMaxIds('100')).toBe(DEFAULT_MAX_IDS)
    expect(clampMaxIds(Number.NaN)).toBe(DEFAULT_MAX_IDS)
  })

  test('a requested value above the ceiling is clamped down, never honored verbatim', () => {
    expect(clampMaxIds(10_000)).toBe(500)
  })

  test('a requested 0 or negative value floors at 1 — an agent can never force an empty-looking list', () => {
    expect(clampMaxIds(0)).toBe(1)
    expect(clampMaxIds(-5)).toBe(1)
  })
})
