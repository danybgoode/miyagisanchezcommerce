import { test, expect } from '@playwright/test'
import {
  defaultSectionConfig,
  normalizeSections,
  navSections,
  navEntries,
  sectionPath,
  validateSectionConfig,
} from '../lib/shop-presentation/sections'
import { ALL_SECTIONS, REQUIRED_SECTIONS, type SectionAvailability } from '../lib/shop-presentation/types'

/**
 * Living Shop · Sprint 3 — the controlled information architecture (Stories 3.1–3.4).
 *
 * Pure. `normalizeSections` is the function every surface funnels through — the
 * public renderer, the seller studio, the settings importer and the MCP tools —
 * so a rule proven here is proven everywhere (epic D12).
 *
 * Observed red by: allowing an anchor to be reordered (the anchors-lead case
 * failed), by dropping the "append unknown-to-the-stored-order keys" step (the
 * new-section case failed), and by making `navSections` ignore availability (the
 * dead-link case failed).
 */

const nothingAvailable: SectionAvailability = {
  collections: false, events: false, about: false, faq: false, policies: false,
}
const allAvailable: SectionAvailability = {
  collections: true, events: true, about: true, faq: true, policies: true,
}

test.describe('sections · normalization never rejects a render', () => {
  test('absent config yields the canonical order with nothing hidden', () => {
    expect(normalizeSections(undefined)).toEqual(defaultSectionConfig())
    expect(normalizeSections(null).order).toEqual([...ALL_SECTIONS])
  })

  test('anchors always lead, whatever the stored order asked for', () => {
    const config = normalizeSections({ order: ['policies', 'shop', 'faq', 'wall'] })
    expect(config.order.slice(0, 2)).toEqual([...REQUIRED_SECTIONS])
  })

  test('the seller order for OPTIONAL sections is honoured', () => {
    const config = normalizeSections({ order: ['events', 'collections', 'about'] })
    expect(config.order).toEqual(['wall', 'shop', 'events', 'collections', 'about', 'faq', 'policies'])
  })

  test('a section the stored order never mentioned still appears — it is not dropped', () => {
    // The failure this prevents: an order written before a section existed would
    // otherwise erase that section from every shop that had ever saved a config.
    const config = normalizeSections({ order: ['about'] })
    expect(new Set(config.order)).toEqual(new Set(ALL_SECTIONS))
    expect(config.order).toHaveLength(ALL_SECTIONS.length)
  })

  test('unknown and duplicate keys are discarded rather than rendered', () => {
    const config = normalizeSections({ order: ['about', 'about', 'blog', 'faq'] })
    expect(config.order.filter((k) => k === 'about')).toHaveLength(1)
    expect(config.order).not.toContain('blog' as never)
  })

  test('an anchor can never be hidden, however the config asks', () => {
    expect(normalizeSections({ hidden: ['wall', 'shop', 'faq'] }).hidden).toEqual(['faq'])
  })

  test('a wildly malformed config still produces a coherent shop', () => {
    for (const junk of [42, 'nope', [], { order: 'not-a-list' }, { hidden: { faq: true } }]) {
      const config = normalizeSections(junk)
      expect(config.order.slice(0, 2)).toEqual([...REQUIRED_SECTIONS])
      expect(new Set(config.order).size).toBe(ALL_SECTIONS.length)
    }
  })
})

test.describe('sections · a hidden section and an empty one both produce NO link', () => {
  test('with nothing behind them, only the anchors render', () => {
    expect(navSections(defaultSectionConfig(), nothingAvailable)).toEqual([...REQUIRED_SECTIONS])
  })

  test('with content behind them, every section renders in order', () => {
    expect(navSections(defaultSectionConfig(), allAvailable)).toEqual([...ALL_SECTIONS])
  })

  test('a hidden section with content behind it does NOT render', () => {
    const config = normalizeSections({ hidden: ['faq'] })
    expect(navSections(config, allAvailable)).not.toContain('faq')
  })

  test('the anchors survive both hiding and emptiness', () => {
    const nav = navSections(normalizeSections({ hidden: ['wall', 'shop'] }), nothingAvailable)
    expect(nav).toEqual([...REQUIRED_SECTIONS])
  })
})

test.describe('sections · routes are channel-correct with no per-channel branch', () => {
  test('on an owned host every path is relative and the Wall is the root', () => {
    expect(sectionPath('wall', '')).toBe('/')
    expect(sectionPath('shop', '')).toBe('/tienda')
    expect(sectionPath('events', '')).toBe('/eventos')
    expect(sectionPath('about', '')).toBe('/acerca')
  })

  test('on the marketplace every path carries the shop prefix', () => {
    expect(sectionPath('wall', '/mx/s/mi-tienda')).toBe('/mx/s/mi-tienda')
    expect(sectionPath('shop', '/mx/s/mi-tienda')).toBe('/mx/s/mi-tienda/tienda')
    expect(sectionPath('policies', '/mx/s/mi-tienda')).toBe('/mx/s/mi-tienda/politicas')
  })

  test('every renderable section has a path — no key can reach the nav without one', () => {
    const entries = navEntries(defaultSectionConfig(), allAvailable, '')
    expect(entries).toHaveLength(ALL_SECTIONS.length)
    for (const entry of entries) expect(entry.path).toMatch(/^\//)
  })
})

test.describe('sections · the WRITE boundary refuses what the renderer forgives', () => {
  test('a valid config is accepted and normalized', () => {
    const result = validateSectionConfig({ order: ['events', 'about'], hidden: ['faq'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.order.slice(0, 2)).toEqual([...REQUIRED_SECTIONS])
  })

  test('an unknown key is a REFUSAL here, though the renderer would discard it', () => {
    const result = validateSectionConfig({ order: ['blog'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.join(' ')).toContain('blog')
  })

  test('hiding an anchor is refused with a reason', () => {
    const result = validateSectionConfig({ hidden: ['wall'] })
    expect(result.ok).toBe(false)
  })

  test('duplicates are refused', () => {
    expect(validateSectionConfig({ order: ['faq', 'faq'] }).ok).toBe(false)
  })

  // The negation of what we ban — a guard that rejected correct input would be
  // worse than one that missed a rare fault.
  test('the full canonical order is accepted', () => {
    expect(validateSectionConfig({ order: [...ALL_SECTIONS], hidden: [] }).ok).toBe(true)
  })
})
