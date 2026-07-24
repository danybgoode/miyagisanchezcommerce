import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES, STAGE_ORDINAL } from '../lib/merchant-stage'
import { METRIC_DICTIONARY, DICTIONARY_STAGES, DICTIONARY_STAGE_ORDINAL, ACTIVATION_STAGE, SCORECARD_SCHEMA_VERSION, SCORECARD_TIMEZONE } from '../lib/scorecard/dictionary'
import { ALL_FIXTURES, zeroJourneyFixture, incompleteJourneyFixture, correctedJourneyFixture, retainedJourneyFixture, staleJourneyFixture } from '../lib/scorecard/fixtures'

/**
 * Merchant activation scorecard · Sprint 1, Story 1.1 (api project,
 * network-free): the versioned metric dictionary contract. `lib/scorecard/
 * dictionary.ts` and `lib/scorecard/types.ts`/`fixtures.ts` are zero-import
 * beyond `lib/merchant-stage.ts`, so every assertion below runs with no
 * database, no Clerk, no Next.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DICTIONARY_SOURCE = readFileSync(join(ROOT, 'lib/scorecard/dictionary.ts'), 'utf8')

test.describe('SD3 — the dictionary IMPORTS the stage contract, never restates it', () => {
  test('DICTIONARY_STAGES deep-equals the canonical STAGES array', () => {
    expect(DICTIONARY_STAGES).toEqual([...STAGES])
  })

  test('DICTIONARY_STAGE_ORDINAL is the SAME object as STAGE_ORDINAL (reference equality, not a copy)', () => {
    expect(DICTIONARY_STAGE_ORDINAL).toBe(STAGE_ORDINAL)
  })

  test('a parallel hardcoded stage count would be caught: STAGES has exactly 13 entries', () => {
    expect(STAGES.length).toBe(13)
    expect(DICTIONARY_STAGES.length).toBe(13)
  })

  test('ACTIVATION_STAGE is a genuine member of STAGES, not a parallel literal', () => {
    expect(STAGES).toContain(ACTIVATION_STAGE)
  })
})

test.describe('SD3 — no restated threshold: dictionary.ts never imports the server-only threshold module', () => {
  test('source text names lib/merchant-medusa-reads only in prose, never as an import', () => {
    expect(DICTIONARY_SOURCE).not.toMatch(/^\s*import[^\n]*merchant-medusa-reads/m)
  })

  test('source text carries no hardcoded retention-window or three-products numeral', () => {
    expect(DICTIONARY_SOURCE).not.toMatch(/RETENTION_WINDOW_DAYS\s*=\s*\d/)
    expect(DICTIONARY_SOURCE).not.toMatch(/THREE_PRODUCTS_THRESHOLD\s*=\s*\d/)
    // The only numeral-shaped identifiers allowed are the STAGES vocabulary's
    // OWN name (`retained_30d`), never a computed "30 days" claim.
    expect(DICTIONARY_SOURCE).not.toMatch(/\b30\s*d[ií]as\b/)
  })
})

test.describe('every metric named in the epic acceptance has one testable definition', () => {
  const REQUIRED_METRICS = [
    'cohort_entry',
    'funnel_stage_count',
    'funnel_stage_conversion',
    'age_in_stage_median_days',
    'age_in_stage_p90_days',
    'overdue_count',
    'missing_action_count',
    'activation_time_median_days',
    'activation_time_p90_days',
    'first_sale_count',
    'first_sale_rate',
    'retained_30d_count',
    'retained_30d_rate',
    'freshness',
  ]

  for (const id of REQUIRED_METRICS) {
    test(`"${id}" is defined with label, description, unit, source and exclusions`, () => {
      const def = METRIC_DICTIONARY[id]
      expect(def, `missing dictionary entry for "${id}"`).toBeTruthy()
      expect(def.id).toBe(id)
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.description.length).toBeGreaterThan(0)
      expect(['count', 'ratio', 'days']).toContain(def.unit)
      expect(def.source.length).toBeGreaterThan(0)
      expect(def.exclusions.length).toBeGreaterThan(0)
    })
  }

  test('the dictionary defines exactly the required metrics — no undocumented extra, no gap', () => {
    expect(Object.keys(METRIC_DICTIONARY).sort()).toEqual([...REQUIRED_METRICS].sort())
  })
})

test.describe('schema version and timezone are stable, versioned constants', () => {
  test('SCORECARD_SCHEMA_VERSION is a positive integer', () => {
    expect(Number.isInteger(SCORECARD_SCHEMA_VERSION)).toBe(true)
    expect(SCORECARD_SCHEMA_VERSION).toBeGreaterThan(0)
  })

  test('SCORECARD_TIMEZONE is Mexico City', () => {
    expect(SCORECARD_TIMEZONE).toBe('America/Mexico_City')
  })
})

test.describe('fixture contract — zero, incomplete, corrected, retained, stale journeys', () => {
  test('ALL_FIXTURES names exactly the five journeys plus the whole-read-failure case', () => {
    expect(Object.keys(ALL_FIXTURES).sort()).toEqual(['corrected', 'incomplete', 'relationshipsReadFailed', 'retained', 'stale', 'zero'].sort())
  })

  test('zero journey — every relationship sits at the baseline stage, no transitions, no emissions', () => {
    const f = zeroJourneyFixture()
    expect(f.relationships.length).toBeGreaterThan(0)
    expect(f.relationships.every((r) => r.stage === 'scouted')).toBe(true)
    expect(f.transitions).toEqual([])
    expect(f.reconciliation.every((r) => r.emissions.length === 0)).toBe(true)
  })

  test('incomplete journey — one relationship has a partial transition trail, one has no linked shop', () => {
    const f = incompleteJourneyFixture()
    const claimed = f.relationships.find((r) => r.stage === 'claimed')
    expect(claimed).toBeTruthy()
    expect(f.transitions.some((t) => t.relationshipId === claimed!.id && t.toStage === 'claimed')).toBe(true)
    expect(f.transitions.some((t) => t.relationshipId === claimed!.id && t.toStage === 'payments_ready')).toBe(false)
    expect(f.relationships.some((r) => r.shopId === null)).toBe(true)
  })

  test('corrected journey — the transition timeline is non-monotonic in ordinal terms (a real correction)', () => {
    const f = correctedJourneyFixture()
    const rel = f.relationships[0]
    const ordered = f.transitions.filter((t) => t.relationshipId === rel.id).map((t) => t.toStage)
    // preview_delivered (ordinal 5) is followed by preview_in_preparation (ordinal 4) —
    // a genuine backward move a correction can produce.
    const deliveredIdx = ordered.indexOf('preview_delivered')
    const laterPrepIdx = ordered.indexOf('preview_in_preparation', deliveredIdx + 1)
    expect(deliveredIdx).toBeGreaterThanOrEqual(0)
    expect(laterPrepIdx).toBeGreaterThan(deliveredIdx)
  })

  test('retained journey — reaches retained_30d with a full transition trail and an ok commerce-fact read', () => {
    const f = retainedJourneyFixture()
    const rel = f.relationships[0]
    expect(rel.stage).toBe('retained_30d')
    expect(f.transitions.some((t) => t.relationshipId === rel.id && t.toStage === 'retained_30d')).toBe(true)
    const facts = f.commerceFacts.find((c) => c.relationshipId === rel.id)
    expect(facts?.ok).toBe(true)
    expect(facts?.firstSale).toBe(true)
    expect(facts?.retained30d).toBe(true)
  })

  test('stale journey — one relationship has a missing delivered emission, one has a failed commerce-facts read', () => {
    const f = staleJourneyFixture()
    const emissionGap = f.reconciliation.find((r) => r.relationshipId === 'r-stale-emission')
    expect(emissionGap?.emissions.length).toBe(0)
    const readFailure = f.commerceFacts.find((c) => c.relationshipId === 'r-stale-read')
    expect(readFailure?.ok).toBe(false)
  })
})
