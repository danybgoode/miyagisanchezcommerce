import { expect, test } from '@playwright/test'
import { STAGE_ORDINAL } from '../lib/merchant-stage'
import { resolveScorecard } from '../lib/scorecard/resolver'
import {
  zeroJourneyFixture,
  incompleteJourneyFixture,
  correctedJourneyFixture,
  retainedJourneyFixture,
  staleJourneyFixture,
  relationshipsReadFailedFixture,
} from '../lib/scorecard/fixtures'

/**
 * Merchant activation scorecard · Sprint 1, Story 1.2 (api project,
 * network-free): `resolveScorecard` exercised against the five named
 * journeys + the whole-read-failure case. `lib/scorecard/resolver.ts` is
 * zero-import beyond `lib/merchant-stage.ts` and the scorecard's own
 * zero-import modules, so every branch below runs with no database.
 */

function funnelFor(scorecard: ReturnType<typeof resolveScorecard>, stage: string) {
  const row = scorecard.funnel.find((f) => f.stage === stage)
  if (!row) throw new Error(`no funnel row for stage ${stage}`)
  return row
}

test.describe('SD4 — a genuine zero is `{ value: 0, health: "ok" }`, never confused with "missing"', () => {
  test('zero journey: the baseline stage has a real count; every later stage is a GENUINE zero, not missing', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    const scouted = funnelFor(scorecard, 'scouted')
    expect(scouted.count).toEqual({ value: 2, health: 'ok', source: 'merchant_relationships.stage', asOf: scorecard.generatedAt })

    for (const stage of ['qualified', 'permission_granted', 'claimed', 'retained_30d']) {
      const row = funnelFor(scorecard, stage)
      expect(row.count.health, `${stage} count health`).toBe('ok')
      expect(row.count.value, `${stage} count value`).toBe(0)
    }
  })

  test('zero journey: a 0/2 conversion is a real ratio (ok); a 0-denominator conversion is missing, never 0', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    const qualified = funnelFor(scorecard, 'qualified')
    expect(qualified.conversionFromPrevious).toEqual({ value: 0, health: 'ok', source: 'funnel_stage_count ratio', asOf: scorecard.generatedAt })

    const permissionGranted = funnelFor(scorecard, 'permission_granted')
    expect(permissionGranted.conversionFromPrevious.health).toBe('missing')
    expect(permissionGranted.conversionFromPrevious.value).toBeNull()
  })

  test('zero journey: the activation-time and commerce metrics are MISSING (no eligible population), not zero', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    expect(scorecard.summary.activationTimeMedianDays.health).toBe('missing')
    expect(scorecard.summary.activationTimeMedianDays.value).toBeNull()
    expect(scorecard.summary.firstSaleCount.health).toBe('missing')
    expect(scorecard.summary.retained30dCount.health).toBe('missing')
  })

  test('zero journey: freshness is OK — nothing has reached a gated milestone, so nothing was ever expected to emit', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    expect(scorecard.freshness.health).toBe('ok')
    expect(scorecard.freshness.staleRelationshipIds).toEqual([])
    expect(scorecard.freshness.checkedCount).toBe(2)
  })

  test('zero journey: scouted aging has a real median/p90 from open intervals; every other stage is missing', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    const scouted = funnelFor(scorecard, 'scouted')
    expect(scouted.agingMedianDays).toEqual({ value: 7.5, health: 'ok', source: expect.stringContaining('merchant_relationship_transitions'), asOf: scorecard.generatedAt })
    expect(scouted.agingP90Days.value).toBe(12)
    const qualified = funnelFor(scorecard, 'qualified')
    expect(qualified.agingMedianDays.health).toBe('missing')
  })
})

test.describe('join — funnel/aging/activation-time derive ONLY from merchant_relationships + transitions (SD1)', () => {
  test('incomplete journey: funnel counts, conversion and per-stage aging match the transition trail exactly', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    expect(funnelFor(scorecard, 'scouted').count.value).toBe(2)
    expect(funnelFor(scorecard, 'qualified').count.value).toBe(2)
    expect(funnelFor(scorecard, 'permission_granted').count.value).toBe(1)
    expect(funnelFor(scorecard, 'claimed').count.value).toBe(1)
    expect(funnelFor(scorecard, 'payments_ready').count.value).toBe(0)
    expect(funnelFor(scorecard, 'payments_ready').count.health).toBe('ok')

    // A genuine 0/1 conversion (ok) vs. the very next stage's 0-denominator (missing).
    expect(funnelFor(scorecard, 'payments_ready').conversionFromPrevious).toEqual(
      expect.objectContaining({ value: 0, health: 'ok' }),
    )
    expect(funnelFor(scorecard, 'three_products_live').conversionFromPrevious.health).toBe('missing')

    expect(funnelFor(scorecard, 'permission_granted').agingMedianDays.value).toBe(9)
    expect(funnelFor(scorecard, 'claimed').agingMedianDays.value).toBe(5) // the open interval — r-incomplete-1's current stage
  })

  test('incomplete journey: activation time uses createdAt → the "claimed" transition, for the eligible population only', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    expect(scorecard.summary.activationTimeMedianDays).toEqual(
      expect.objectContaining({ value: 15, health: 'ok' }),
    )
    expect(scorecard.summary.activationIds).toEqual(['r-incomplete-1'])
  })

  test('incomplete journey: first-sale/retention exclude the shop-less relationship from the eligible population', () => {
    const scorecard = resolveScorecard(incompleteJourneyFixture())
    expect(scorecard.summary.firstSaleCount).toEqual(expect.objectContaining({ value: 0, health: 'ok' }))
    expect(scorecard.summary.firstSaleIds).toEqual([])
  })

  test('corrected journey: a non-ordinal-monotonic transition still contributes real calendar-time duration', () => {
    const scorecard = resolveScorecard(correctedJourneyFixture())
    // Two separate intervals in preview_in_preparation (before AND after the
    // correction) both land in the SAME stage bucket — durations accumulate,
    // they don't overwrite.
    const previewPrep = funnelFor(scorecard, 'preview_in_preparation')
    expect(previewPrep.agingMedianDays.health).toBe('ok')
    // preview_delivered → preview_in_preparation (10 days) is one closed
    // interval; the open interval (now sitting in preview_in_preparation,
    // ageInStageDays: 4) is the other. Two samples, not one.
    expect(Array.isArray(previewPrep.drillThroughIds)).toBe(true)
  })

  test('retained journey: reaches every metric family with ok health — the happy path is reachable', () => {
    const scorecard = resolveScorecard(retainedJourneyFixture())
    expect(scorecard.summary.firstSaleCount).toEqual(expect.objectContaining({ value: 1, health: 'ok' }))
    expect(scorecard.summary.retained30dCount).toEqual(expect.objectContaining({ value: 1, health: 'ok' }))
    expect(scorecard.summary.activationTimeMedianDays.health).toBe('ok')
    expect(scorecard.freshness.health).toBe('ok')
    expect(funnelFor(scorecard, 'retained_30d').count.value).toBe(1)
  })
})

test.describe('freshness / mismatch — the Golden Beans diagnostic never rewrites the canonical stage (SD1)', () => {
  test('stale journey: a delivery gap flags the relationship, but its canonical funnel placement is untouched', () => {
    const scorecard = resolveScorecard(staleJourneyFixture())
    expect(scorecard.freshness.health).toBe('stale')
    expect(scorecard.freshness.staleRelationshipIds).toEqual(['r-stale-emission'])
    // r-stale-emission is STILL counted at `claimed` in the funnel — freshness
    // is a diagnostic overlay, never a source of the funnel number itself.
    expect(funnelFor(scorecard, 'claimed').drillThroughIds).toContain('r-stale-emission')
  })

  test('stale journey: a FAILED commerce-facts read degrades first-sale to stale with a best-effort value, excluding that relationship from the denominator', () => {
    const scorecard = resolveScorecard(staleJourneyFixture())
    expect(scorecard.summary.firstSaleCount.health).toBe('stale')
    // Best-effort: 0 of the ONE usable relationship (r-stale-emission) had a
    // sale — a real, non-null number, distinct from "missing" (SD4: `stale`
    // MAY carry a value; `missing` never does).
    expect(scorecard.summary.firstSaleCount.value).toBe(0)
    expect(scorecard.summary.firstSaleIds).toEqual([])
  })

  test('stale journey: activation time is UNAFFECTED by the emission gap or the read failure — its own inputs are complete', () => {
    const scorecard = resolveScorecard(staleJourneyFixture())
    expect(scorecard.summary.activationTimeMedianDays).toEqual(expect.objectContaining({ value: 13, health: 'ok' }))
    expect(scorecard.summary.activationIds.sort()).toEqual(['r-stale-emission', 'r-stale-read'].sort())
  })
})

test.describe('whole-input read failure — every metric degrades to missing, never a substituted zero', () => {
  test('relationshipsOk: false → cohortEntry, every funnel count, and freshness are all "missing"', () => {
    const scorecard = resolveScorecard(relationshipsReadFailedFixture())
    expect(scorecard.summary.cohortEntry).toEqual({ value: null, health: 'missing', source: 'merchant_relationships', asOf: scorecard.generatedAt })
    for (const row of scorecard.funnel) {
      expect(row.count.health, `${row.stage} count health`).toBe('missing')
      expect(row.count.value, `${row.stage} count value`).toBeNull()
    }
    expect(scorecard.freshness.health).toBe('missing')
    expect(scorecard.summary.overdueCount.health).toBe('missing')
    expect(scorecard.summary.missingActionCount.health).toBe('missing')
  })
})

test.describe('schema version and stage ordinal wiring stay consistent with the canonical contract', () => {
  test('the funnel walks STAGES in canonical ordinal order, 1..13', () => {
    const scorecard = resolveScorecard(zeroJourneyFixture())
    expect(scorecard.funnel.map((f) => f.ordinal)).toEqual(scorecard.funnel.map((f) => STAGE_ORDINAL[f.stage]))
    expect(scorecard.funnel.map((f) => f.ordinal)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })

  test('the resolver echoes the caller-supplied thresholds verbatim, never a hardcoded copy', () => {
    const input = zeroJourneyFixture()
    input.thresholds = { retentionWindowDays: 45, threeProductsThreshold: 5 }
    const scorecard = resolveScorecard(input)
    expect(scorecard.thresholds).toEqual({ retentionWindowDays: 45, threeProductsThreshold: 5 })
  })
})
