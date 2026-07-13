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

  // Sprint 4 — Daniel flagged (via screenshot review) that the group header
  // and every sibling section rendered the SAME text.
  test('a NON-uniform group (sellerAcquisition) keeps its curated per-section route label — cross-agent review caught a regression here', () => {
    // sellerAcquisition's route.label is ALREADY a good, curated, per-section
    // differentiator ("Vende — Autos", "Vende (portada)") — an earlier
    // version of this fix replaced it with a generic word-split fallback
    // ("Autos", "Anchor"), a real quality regression a cross-agent review
    // caught. The section's own route label must win whenever it actually
    // differentiates (i.e. the group isn't uniform).
    const groups = buildPageNavGroups(keys)
    const sa = groups.find((g) => g.namespace === 'sellerAcquisition')!
    expect(sa.uniformRoute).toBeNull()
    expect(sa.sections.find((s) => s.section === 'autos')?.label).toBe('Vende — Autos')
    expect(sa.sections.find((s) => s.section === 'anchor')?.label).toBe('Vende (portada)')
  })

  test('a UNIFORM group (home, terms) falls back to the humanized section key, since every route label is identical', () => {
    const groups = buildPageNavGroups(keys)
    const home = groups.find((g) => g.namespace === 'home')!
    expect(home.uniformRoute).not.toBeNull()
    expect(home.sections.find((s) => s.section === 'ribbon')?.label).toBe('Ribbon')
  })

  test('a section whose route fails to resolve falls back to the humanized section key even in a non-uniform group', () => {
    const groups = buildPageNavGroups([
      { namespace: 'sweepstakes', key: 'public.notFound' },
      { namespace: 'sweepstakes', key: 'bogusSection.x' },
    ])
    const sweepstakes = groups.find((g) => g.namespace === 'sweepstakes')!
    expect(sweepstakes.uniformRoute).toBeNull()
    expect(sweepstakes.sections.find((s) => s.section === 'bogusSection')?.route).toBeNull()
    expect(sweepstakes.sections.find((s) => s.section === 'bogusSection')?.label).toBe('Bogus Section')
  })

  test('uniformRoute is set when every section in a group shares the exact same destination', () => {
    // Simulates `home`: multiple sections, all rendering on the same page.
    const groups = buildPageNavGroups([
      { namespace: 'home', key: 'ribbon.body' },
      { namespace: 'home', key: 'selection.heading' },
    ])
    const home = groups.find((g) => g.namespace === 'home')!
    expect(home.uniformRoute).toEqual({ label: 'Inicio', path: '/' })
  })

  test('uniformRoute is null when a group\'s sections genuinely point at different destinations', () => {
    // Simulates `sweepstakes`: seller/public sections render on different surfaces (Sprint 4 routing fix).
    const groups = buildPageNavGroups([
      { namespace: 'sweepstakes', key: 'public.notFound' },
      { namespace: 'sweepstakes', key: 'seller.killSwitch' },
    ])
    const sweepstakes = groups.find((g) => g.namespace === 'sweepstakes')!
    expect(sweepstakes.uniformRoute).toBeNull()
  })

  test('a single-section group is trivially uniform', () => {
    const groups = buildPageNavGroups(keys)
    const terms = groups.find((g) => g.namespace === 'terms')!
    expect(terms.uniformRoute).toEqual({ label: 'Términos', path: '/terminos' })
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
