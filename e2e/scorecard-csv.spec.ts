import { expect, test } from '@playwright/test'
import { resolveScorecard } from '../lib/scorecard/resolver'
import { scorecardToCsv } from '../lib/scorecard/csv'
import { incompleteJourneyFixture, retainedJourneyFixture, staleJourneyFixture } from '../lib/scorecard/fixtures'

/**
 * Merchant activation scorecard · Sprint 2, Story 2.2 (api project,
 * network-free): the CSV export applies the IDENTICAL resolver output as
 * the UI/agent (decision 2) — this spec builds a `Scorecard` via the SAME
 * `resolveScorecard` the endpoint calls, serializes it, and parses the CSV
 * back to prove the totals agree with the source object, with no HTTP call
 * and no database.
 */

function parseCsv(csv: string): string[][] {
  return csv
    .trim()
    .split('\r\n')
    .map((line) => line.split(','))
}

function findSection(rows: string[][], headerRow: string[]): string[][] {
  const idx = rows.findIndex((r) => r.join(',') === headerRow.join(','))
  if (idx === -1) throw new Error(`section header not found: ${headerRow.join(',')}`)
  const out: string[][] = []
  for (let i = idx + 1; i < rows.length && rows[i].length === headerRow.length && rows[i][0] !== ''; i++) {
    out.push(rows[i])
  }
  return out
}

test.describe('CSV totals match the resolver output exactly', () => {
  test('metric section values equal scorecard.summary values, including health', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    const rows = parseCsv(scorecardToCsv(scorecard))
    const metrics = findSection(rows, ['metric', 'value', 'health'])
    const byId = Object.fromEntries(metrics.map((r) => [r[0], r]))

    expect(byId['cohort_entry'][1]).toBe(String(scorecard.summary.cohortEntry.value))
    expect(byId['cohort_entry'][2]).toBe(scorecard.summary.cohortEntry.health)
    expect(byId['first_sale_count'][1]).toBe(String(scorecard.summary.firstSaleCount.value))
    expect(byId['overdue_count'][1]).toBe(String(scorecard.summary.overdueCount.value))
  })

  test('funnel section has exactly 13 rows, one per canonical stage, in order', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    const rows = parseCsv(scorecardToCsv(scorecard))
    const funnel = findSection(rows, ['stage', 'ordinal', 'count', 'count_health', 'conversion_from_previous', 'conversion_health', 'age_median_days', 'age_median_health', 'age_p90_days', 'age_p90_health'])
    expect(funnel).toHaveLength(13)
    expect(funnel.map((r) => r[0])).toEqual(scorecard.funnel.map((f) => f.stage))
    expect(funnel.map((r) => Number(r[2]))).toEqual(scorecard.funnel.map((f) => f.count.value))
  })

  test('a missing metric value renders as an EMPTY cell, never a literal "0" or "null" string', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture()) // three_products_live conversion is missing
    const csv = scorecardToCsv(scorecard)
    const rows = parseCsv(csv)
    const funnel = findSection(rows, ['stage', 'ordinal', 'count', 'count_health', 'conversion_from_previous', 'conversion_health', 'age_median_days', 'age_median_health', 'age_p90_days', 'age_p90_health'])
    const threeProducts = funnel.find((r) => r[0] === 'three_products_live')!
    expect(threeProducts[4]).toBe('') // conversion_from_previous value
    expect(threeProducts[5]).toBe('missing') // conversion_health
  })

  test('drill-through rows exactly cover every id the resolver returned for a metric — the row COUNT matches the metric value', () => {
    const scorecard = resolveScorecard(retainedJourneyFixture())
    const rows = parseCsv(scorecardToCsv(scorecard))
    const drillThrough = findSection(rows, ['drill_through_metric', 'relationship_id', 'business_name', 'stage'])
    const firstSaleRows = drillThrough.filter((r) => r[0] === 'first_sale')
    expect(firstSaleRows).toHaveLength(scorecard.summary.firstSaleCount.value ?? -1)
    expect(firstSaleRows.map((r) => r[1])).toEqual(scorecard.summary.firstSaleIds)
    // The business name in the CSV row matches the SAME merchants map the UI reads.
    expect(firstSaleRows[0][2]).toBe(scorecard.merchants[firstSaleRows[0][1]].businessName)
  })

  test('no contact PII column exists anywhere in the CSV (phone, email, whatsapp, instagram)', () => {
    const scorecard = resolveScorecard(staleJourneyFixture())
    const csv = scorecardToCsv(scorecard).toLowerCase()
    for (const term of ['phone', 'email', 'whatsapp', 'instagram', 'telefono', 'teléfono']) {
      expect(csv).not.toContain(term)
    }
  })

  test('freshness section reflects the SAME staleRelationshipIds count as the resolver output', () => {
    const scorecard = resolveScorecard(staleJourneyFixture())
    const rows = parseCsv(scorecardToCsv(scorecard))
    const freshness = findSection(rows, ['freshness_health', 'freshness_checked_count', 'freshness_stale_count', 'freshness_as_of'])
    expect(freshness).toHaveLength(1)
    expect(freshness[0][0]).toBe(scorecard.freshness.health)
    expect(Number(freshness[0][2])).toBe(scorecard.freshness.staleRelationshipIds.length)
  })
})
