import { expect, test } from '@playwright/test'
import { buildPageNavGroups, firstNavSelection, isValidNavSelection } from '../lib/copy-overrides-page-nav'

// Pure-seam coverage for the page-first nav grouping (epic 08 ·
// cms-contenido-restore-and-polish, Story 3.1) — the SAME namespace/section
// bucketing the editor used to render as a nested <details> accordion
// (Sprint 1/2), now exposed as navigable groups.

const keys = [
  { namespace: 'sellerAcquisition', key: 'autos.heroTitle' },
  { namespace: 'sellerAcquisition', key: 'autos.heroBody' },
  { namespace: 'sellerAcquisition', key: 'anchor.heroTitle' },
  { namespace: 'home', key: 'ribbon.body' },
  { namespace: 'terms', key: 'title' },
]

test.describe('buildPageNavGroups', () => {
  test('buckets by namespace then section (first dot-segment), sorted alphabetically', () => {
    const groups = buildPageNavGroups(keys)
    expect(groups.map((g) => g.namespace)).toEqual(['home', 'sellerAcquisition', 'terms'])

    const sa = groups.find((g) => g.namespace === 'sellerAcquisition')!
    expect(sa.sections.map((s) => s.section)).toEqual(['anchor', 'autos'])
    expect(sa.sections.find((s) => s.section === 'autos')?.count).toBe(2)
    expect(sa.count).toBe(3)
  })

  test('a single-segment key becomes its own section (key === section)', () => {
    const groups = buildPageNavGroups(keys)
    const terms = groups.find((g) => g.namespace === 'terms')!
    expect(terms.sections.map((s) => s.section)).toEqual(['title'])
  })

  test('resolves a real route for a known namespace/section, null for an unknown one', () => {
    const groups = buildPageNavGroups(keys)
    const home = groups.find((g) => g.namespace === 'home')!
    expect(home.sections[0].route).toEqual({ label: 'Inicio', path: '/' })

    const unknown = buildPageNavGroups([{ namespace: 'bogus', key: 'foo.bar' }])
    expect(unknown[0].sections[0].route).toBeNull()
  })

  test('an empty key list produces an empty nav', () => {
    expect(buildPageNavGroups([])).toEqual([])
  })
})

test.describe('firstNavSelection', () => {
  test('picks the alphabetically-first namespace and its first section', () => {
    const groups = buildPageNavGroups(keys)
    expect(firstNavSelection(groups)).toEqual({ namespace: 'home', section: 'ribbon' })
  })

  test('an empty nav resolves to empty strings, never throws', () => {
    expect(firstNavSelection([])).toEqual({ namespace: '', section: '' })
  })
})

test.describe('isValidNavSelection', () => {
  test('true only for a namespace+section pair that actually exists together', () => {
    const groups = buildPageNavGroups(keys)
    expect(isValidNavSelection(groups, 'sellerAcquisition', 'autos')).toBe(true)
    expect(isValidNavSelection(groups, 'sellerAcquisition', 'nope')).toBe(false)
    expect(isValidNavSelection(groups, 'nope', 'autos')).toBe(false)
    expect(isValidNavSelection(groups, '', '')).toBe(false)
  })
})
