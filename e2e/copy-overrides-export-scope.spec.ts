import { expect, test } from '@playwright/test'
import {
  countForScope,
  describeExportScope,
  namespacesInIndex,
  sectionsForNamespace,
  type KeyIndexEntry,
} from '../lib/copy-overrides-export-scope'

// Pure-seam coverage for the bulk export/import scope dropdowns (epic 08 ·
// cms-contenido-restore-and-polish, Story 2.2). No browser, no network.

const index: KeyIndexEntry[] = [
  { namespace: 'sellerAcquisition', key: 'autos.heroTitle' },
  { namespace: 'sellerAcquisition', key: 'autos.heroLead' },
  { namespace: 'sellerAcquisition', key: 'anchor.heroTitle' },
  { namespace: 'home', key: 'hero.heading' },
  { namespace: 'home', key: 'hero.badges' },
  { namespace: 'terms', key: 'title' },
]

test.describe('namespacesInIndex', () => {
  test('every distinct namespace, sorted', () => {
    expect(namespacesInIndex(index)).toEqual(['home', 'sellerAcquisition', 'terms'])
  })
})

test.describe('sectionsForNamespace', () => {
  test('cascades to the sections within the chosen namespace only', () => {
    expect(sectionsForNamespace(index, 'sellerAcquisition')).toEqual(['anchor', 'autos'])
    expect(sectionsForNamespace(index, 'home')).toEqual(['hero'])
  })

  test('an empty namespace (no selection) yields no sections', () => {
    expect(sectionsForNamespace(index, '')).toEqual([])
  })
})

test.describe('countForScope', () => {
  test('empty namespace + section counts everything', () => {
    expect(countForScope(index, '', '')).toBe(index.length)
  })

  test('namespace only counts every key in that namespace', () => {
    expect(countForScope(index, 'sellerAcquisition', '')).toBe(3)
    expect(countForScope(index, 'home', '')).toBe(2)
  })

  test('namespace + section narrows to that exact section', () => {
    expect(countForScope(index, 'sellerAcquisition', 'autos')).toBe(2)
    expect(countForScope(index, 'sellerAcquisition', 'anchor')).toBe(1)
  })
})

test.describe('describeExportScope', () => {
  test('no namespace: "todas las páginas"', () => {
    expect(describeExportScope('', '', 6)).toBe('Esto exportará 6 claves de todas las páginas, en el formato que elijas.')
  })

  test('namespace only: names the page', () => {
    expect(describeExportScope('home', '', 2)).toBe('Esto exportará 2 claves de Inicio, en el formato que elijas.')
  })

  test('namespace + section: names the page and section, arrow-joined', () => {
    expect(describeExportScope('sellerAcquisition', 'autos', 2)).toBe(
      'Esto exportará 2 claves de Vende (todas las páginas) → Vende — Autos, en el formato que elijas.',
    )
  })

  test('singular "clave" for a count of exactly 1', () => {
    expect(describeExportScope('sellerAcquisition', 'anchor', 1)).toBe(
      'Esto exportará 1 clave de Vende (todas las páginas) → Vende (portada), en el formato que elijas.',
    )
  })
})
