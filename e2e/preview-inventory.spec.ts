import { test, expect } from '@playwright/test'
import {
  classifyProvenance,
  categorizeShop,
  buildInventoryReport,
  renderInventoryMarkdown,
  type InventoryShop,
} from '../lib/preview-inventory'

/**
 * Founding merchant consent-safe previews · Sprint 3.2 (api project, network-free) —
 * the historical public/unclaimed inventory classifier.
 *
 * The acceptance in one list: identifies provenance / public product count / claim
 * state / last activity, recommends review categories, performs NO mutation, labels
 * unknown provenance as unknown, and reruns deterministically over the same dataset.
 */

const shop = (over: Partial<InventoryShop> = {}): InventoryShop => ({
  id: 'shop-1',
  slug: 'panaderia-lupita',
  name: 'Panadería Lupita',
  sourceUrl: 'promoter://PRM-ABC/panaderia-lupita',
  clerkUserId: null,
  publicListingCount: 3,
  hasAnchor: false,
  anchorStatus: null,
  lastActivityAt: '2026-07-01T00:00:00Z',
  ...over,
})

test.describe('provenance classification', () => {
  test('a promoter:// source is promoter-created', () => {
    expect(classifyProvenance('promoter://PRM-ABC/lupita')).toBe('promoter')
    expect(classifyProvenance('PROMOTER://PRM-ABC/lupita')).toBe('promoter')
  })

  test('an http(s) source is an import', () => {
    expect(classifyProvenance('https://example.com/scraped')).toBe('import')
    expect(classifyProvenance('http://example.com/scraped')).toBe('import')
  })

  test('missing or unrecognized provenance is labeled UNKNOWN, never guessed', () => {
    for (const value of [null, undefined, '', '   ', 'some-internal-marker']) {
      expect(classifyProvenance(value as string | null)).toBe('unknown')
    }
  })
})

test.describe('review categories', () => {
  test('THE target population: promoter-created, public, unclaimed, unanchored', () => {
    const row = categorizeShop(shop())
    expect(row.category).toBe('public_unclaimed_promoter')
    expect(row.claimState).toBe('unclaimed')
    expect(row.recommendation).toContain('Revisar')
  })

  test('a CLAIMED shop is the merchant’s own — the consent rule never applies', () => {
    // Highest-priority check: a claimed shop is never in the historical population,
    // whatever its provenance or public footprint.
    for (const over of [{}, { hasAnchor: true, anchorStatus: 'draft' }, { publicListingCount: 0 }]) {
      const row = categorizeShop(shop({ clerkUserId: 'user_123', ...over }))
      expect(row.category).toBe('merchant_owned')
    }
  })

  test('an anchored shop is already governed by this epic', () => {
    expect(categorizeShop(shop({ hasAnchor: true, anchorStatus: 'draft' })).category).toBe('in_consent_flow')
    expect(categorizeShop(shop({ hasAnchor: true, anchorStatus: 'approved' })).category).toBe('in_consent_flow')
    expect(categorizeShop(shop({ hasAnchor: true, anchorStatus: 'activated' })).category).toBe('activated_via_consent')
  })

  test('nothing public ⇒ low priority, regardless of provenance', () => {
    expect(categorizeShop(shop({ publicListingCount: 0 })).category).toBe('no_public_presence')
    expect(categorizeShop(shop({ publicListingCount: 0, sourceUrl: null })).category).toBe('no_public_presence')
  })

  test('public + unclaimed but NOT promoter-made is its own bucket', () => {
    expect(categorizeShop(shop({ sourceUrl: 'https://example.com/x' })).category).toBe('public_unclaimed_other')
    expect(categorizeShop(shop({ sourceUrl: null })).category).toBe('public_unclaimed_other')
  })
})

test.describe('report — deterministic and read-only', () => {
  const dataset: InventoryShop[] = [
    shop({ id: '1', slug: 'zeta', name: 'Zeta' }),
    shop({ id: '2', slug: 'alfa', name: 'Alfa' }),
    shop({ id: '3', slug: 'beta', name: 'Beta', clerkUserId: 'user_9' }),
    shop({ id: '4', slug: 'gama', name: 'Gama', hasAnchor: true, anchorStatus: 'delivered' }),
    shop({ id: '5', slug: 'delta', name: 'Delta', sourceUrl: null, publicListingCount: 0 }),
    shop({ id: '6', slug: 'epsilon', name: 'Epsilon', sourceUrl: 'https://tienda.example/x' }),
  ]

  test('rerunning over the same dataset is byte-identical', () => {
    const a = buildInventoryReport(dataset)
    const b = buildInventoryReport(JSON.parse(JSON.stringify(dataset)))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(renderInventoryMarkdown(a)).toBe(renderInventoryMarkdown(b))
  })

  test('input ORDER does not change the report', () => {
    const forward = buildInventoryReport(dataset)
    const reversed = buildInventoryReport([...dataset].reverse())
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })

  test('the report carries no timestamp of its own (that is what makes it stable)', () => {
    const markdown = renderInventoryMarkdown(buildInventoryReport(dataset))
    // Only the per-row lastActivityAt dates from the data may appear.
    expect(markdown).not.toMatch(/Generado|Generated at/i)
  })

  test('the highest-attention category sorts first, then slug', () => {
    const { rows } = buildInventoryReport(dataset)
    expect(rows[0].category).toBe('public_unclaimed_promoter')
    expect(rows[0].slug).toBe('alfa')
    expect(rows[1].slug).toBe('zeta')
    expect(rows[rows.length - 1].category).toBe('merchant_owned')
  })

  test('summary counts every row exactly once', () => {
    const { summary } = buildInventoryReport(dataset)
    expect(summary.total).toBe(dataset.length)
    const categoryTotal = Object.values(summary.byCategory).reduce((a, b) => a + b, 0)
    const provenanceTotal = Object.values(summary.byProvenance).reduce((a, b) => a + b, 0)
    expect(categoryTotal).toBe(dataset.length)
    expect(provenanceTotal).toBe(dataset.length)
  })

  test('categorizing never mutates its input (the report is an audit, not a change)', () => {
    const input = shop()
    const before = JSON.stringify(input)
    categorizeShop(input)
    buildInventoryReport([input])
    expect(JSON.stringify(input)).toBe(before)
  })

  test('an empty dataset is a valid, empty report', () => {
    const report = buildInventoryReport([])
    expect(report.summary.total).toBe(0)
    expect(report.rows).toEqual([])
    expect(renderInventoryMarkdown(report)).toContain('**Total de tiendas:** 0')
  })
})
