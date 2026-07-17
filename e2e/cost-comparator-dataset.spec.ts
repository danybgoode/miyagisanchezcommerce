import { expect, test } from '@playwright/test'
import {
  validateDataset,
  applyDatasetOverrides,
  shopifyRatesFromDataset,
  premiumAppsFromDataset,
  type ComparatorDataset,
} from '../lib/cost-comparator-dataset'
import type { OverrideRow } from '../lib/copy-overrides-merge'
// Import attribute required here (not inside a `server-only` lib file) so Node's
// native ESM loader — which the Playwright `api` runner uses — can load the raw
// JSON directly. Mirrors e2e/copy-overrides-merge.spec.ts's import of locales/es.json
// (see lib/cost-comparator-dataset.ts's file header for the full explanation).
import baselineDataset from '../lib/cost-comparator-dataset.json' with { type: 'json' }

const baseline = baselineDataset as ComparatorDataset

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.2) — the
// CI guard (every shipped figure must carry a source + a verified date) + coverage
// for the fail-open numeric override merge.

test.describe('cost-comparator-dataset · CI guard — the shipped baseline', () => {
  test('every figure in the real dataset has a source, a valid verifiedAt, a label, and a finite value', () => {
    const problems = validateDataset(baseline)
    expect(problems, problems.join('\n')).toEqual([])
  })

  test('the baseline is non-empty and versioned', () => {
    expect(baseline.version).toBeGreaterThan(0)
    expect(Object.keys(baseline.figures).length).toBeGreaterThan(20)
    expect(baseline.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('the real dataset resolves into a Shopify rate bag with no missing figures', () => {
    // shopifyRatesFromDataset throws on any missing key — a smoke that the dataset's
    // figure keys and the adapter's expectations haven't drifted apart.
    expect(() => shopifyRatesFromDataset(baseline)).not.toThrow()
  })

  test('the real dataset yields 3 premium-app options, every one Miyagi-included', () => {
    const apps = premiumAppsFromDataset(baseline)
    expect(apps.length).toBe(3)
    for (const app of apps) {
      expect(app.miyagiIncluded).toBe(true)
      expect(app.monthlyUsd).toBeGreaterThan(0)
    }
  })
})

test.describe('cost-comparator-dataset · validateDataset catches unsourced figures', () => {
  function makeDataset(figure: Partial<ComparatorDataset['figures']['x']>): ComparatorDataset {
    return {
      version: 1,
      generatedAt: '2026-07-17',
      figures: { x: { value: 1, source: 'https://example.com', verifiedAt: '2026-07-17', label: 'X', ...figure } },
    }
  }

  test('a missing source fails', () => {
    expect(validateDataset(makeDataset({ source: '' }))).toContain('x: missing source')
  })

  test('a missing/invalid verifiedAt fails', () => {
    expect(validateDataset(makeDataset({ verifiedAt: '' }))).toContain('x: verifiedAt is not an ISO date (YYYY-MM-DD)')
    expect(validateDataset(makeDataset({ verifiedAt: '07/17/2026' }))).toContain('x: verifiedAt is not an ISO date (YYYY-MM-DD)')
  })

  test('a future verifiedAt fails', () => {
    const problems = validateDataset(makeDataset({ verifiedAt: '2099-01-01' }), new Date('2026-07-17'))
    expect(problems).toContain('x: verifiedAt is in the future')
  })

  test('a non-finite value fails', () => {
    expect(validateDataset(makeDataset({ value: NaN }))).toContain('x: value is not a finite number')
  })

  test('a clean figure passes', () => {
    expect(validateDataset(makeDataset({}))).toEqual([])
  })
})

test.describe('cost-comparator-dataset · applyDatasetOverrides (the applyCopyOverrides numeric sibling)', () => {
  const dataset: ComparatorDataset = {
    version: 1,
    generatedAt: '2026-07-17',
    figures: {
      'shopify.plan.basico.monthlyUsd': { value: 19, source: 'https://example.com', verifiedAt: '2026-07-17', label: 'Plan' },
    },
  }

  test('replaces an existing figure when the row matches namespace + locale', () => {
    const overrides: OverrideRow[] = [{ namespace: 'comparator', key: 'shopify.plan.basico.monthlyUsd', locale: 'es', value: '25' }]
    const next = applyDatasetOverrides(dataset, overrides, 'es')
    expect(next.figures['shopify.plan.basico.monthlyUsd'].value).toBe(25)
    // Immutable — the original dataset is untouched.
    expect(dataset.figures['shopify.plan.basico.monthlyUsd'].value).toBe(19)
  })

  test('a wrong namespace is skipped (fail-open, never fabricates)', () => {
    const overrides: OverrideRow[] = [{ namespace: 'home', key: 'shopify.plan.basico.monthlyUsd', locale: 'es', value: '25' }]
    const next = applyDatasetOverrides(dataset, overrides, 'es')
    expect(next).toBe(dataset) // same reference — no-op
  })

  test('a wrong locale is skipped', () => {
    const overrides: OverrideRow[] = [{ namespace: 'comparator', key: 'shopify.plan.basico.monthlyUsd', locale: 'en', value: '25' }]
    const next = applyDatasetOverrides(dataset, overrides, 'es')
    expect(next.figures['shopify.plan.basico.monthlyUsd'].value).toBe(19)
  })

  test('an unknown figure key is skipped — never fabricates a new figure', () => {
    const overrides: OverrideRow[] = [{ namespace: 'comparator', key: 'shopify.plan.nope.monthlyUsd', locale: 'es', value: '999' }]
    const next = applyDatasetOverrides(dataset, overrides, 'es')
    expect(next.figures['shopify.plan.nope.monthlyUsd']).toBeUndefined()
    expect(next).toBe(dataset)
  })

  test('an unparseable value is skipped', () => {
    const overrides: OverrideRow[] = [{ namespace: 'comparator', key: 'shopify.plan.basico.monthlyUsd', locale: 'es', value: 'not-a-number' }]
    const next = applyDatasetOverrides(dataset, overrides, 'es')
    expect(next.figures['shopify.plan.basico.monthlyUsd'].value).toBe(19)
  })

  test('no overrides at all returns the baseline untouched', () => {
    expect(applyDatasetOverrides(dataset, [], 'es')).toBe(dataset)
  })
})
