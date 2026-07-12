import { expect, test } from '@playwright/test'
import {
  buildContenidoPageUrl,
  filterKeysByNamespace,
  filterKeysByQuery,
  filterKeysByStatus,
  paginate,
  sortKeys,
} from '../lib/copy-overrides-admin-view'

// Pure-seam coverage for /admin/contenido's search/filter/sort/pagination
// (epic 08 · cms-contenido-restore-and-polish, Story 2.1). No browser, no
// network — mirrors `flags-admin-view.spec.ts`'s coverage shape.

const rows = [
  { namespace: 'sellerAcquisition', key: 'autos.heroTitle', defaultEs: 'Vende tu auto', defaultEn: null, overrideEs: null, overrideEn: null, updatedAt: null },
  { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', defaultEs: 'Vende lo que sea', defaultEn: null, overrideEs: 'Vende gratis', overrideEn: null, updatedAt: '2026-07-10T00:00:00Z' },
  { namespace: 'home', key: 'ribbon.body', defaultEs: 'Promoción de temporada', defaultEn: null, overrideEs: null, overrideEn: null, updatedAt: null },
  { namespace: 'terms', key: 'title', defaultEs: 'Términos de uso', defaultEn: 'Terms of use', overrideEs: null, overrideEn: 'Terms — edited', updatedAt: '2026-07-12T00:00:00Z' },
]

test.describe('filterKeysByQuery', () => {
  test('matches namespace, key, or either locale default, case-insensitively', () => {
    expect(filterKeysByQuery(rows, 'autos')).toHaveLength(1)
    expect(filterKeysByQuery(rows, 'HERO')).toHaveLength(2)
    expect(filterKeysByQuery(rows, 'terms of use')).toHaveLength(1)
    expect(filterKeysByQuery(rows, '')).toHaveLength(rows.length)
  })
})

test.describe('filterKeysByNamespace', () => {
  test('empty or "all" returns everything; a specific namespace filters', () => {
    expect(filterKeysByNamespace(rows, '')).toHaveLength(rows.length)
    expect(filterKeysByNamespace(rows, 'all')).toHaveLength(rows.length)
    expect(filterKeysByNamespace(rows, 'sellerAcquisition')).toHaveLength(2)
    expect(filterKeysByNamespace(rows, 'home')).toHaveLength(1)
  })
})

test.describe('filterKeysByStatus', () => {
  test('overridden vs default (either locale counts as overridden)', () => {
    expect(filterKeysByStatus(rows, 'all')).toHaveLength(rows.length)
    expect(filterKeysByStatus(rows, 'overridden')).toHaveLength(2) // anchor (es) + terms (en)
    expect(filterKeysByStatus(rows, 'default')).toHaveLength(2) // autos + home
  })
})

test.describe('sortKeys', () => {
  test('namespace_asc sorts by namespace then key, fully deterministic', () => {
    const sorted = sortKeys(rows, 'namespace_asc')
    expect(sorted.map((r) => `${r.namespace}.${r.key}`)).toEqual([
      'home.ribbon.body',
      'sellerAcquisition.anchor.heroTitle',
      'sellerAcquisition.autos.heroTitle',
      'terms.title',
    ])
  })

  test('recent sorts by updatedAt desc, nulls last, tie-broken by namespace+key', () => {
    const sorted = sortKeys(rows, 'recent')
    expect(sorted.map((r) => `${r.namespace}.${r.key}`)).toEqual([
      'terms.title', // 2026-07-12
      'sellerAcquisition.anchor.heroTitle', // 2026-07-10
      'home.ribbon.body', // null — tie-broken by namespace+key
      'sellerAcquisition.autos.heroTitle', // null
    ])
  })
})

test.describe('paginate', () => {
  test('slices correctly and clamps an out-of-range page instead of returning empty', () => {
    const p1 = paginate(rows, 1, 2)
    expect(p1.pageItems).toHaveLength(2)
    expect(p1.totalPages).toBe(2)
    expect(p1.page).toBe(1)

    const clamped = paginate(rows, 99, 2)
    expect(clamped.page).toBe(2)
    expect(clamped.pageItems).toHaveLength(2)
  })

  test('a page <= 0 or NaN clamps to page 1', () => {
    expect(paginate(rows, 0, 2).page).toBe(1)
    expect(paginate(rows, NaN, 2).page).toBe(1)
  })
})

test.describe('buildContenidoPageUrl', () => {
  test('omits default/empty/all values and page=1', () => {
    expect(buildContenidoPageUrl({}, 1)).toBe('/admin/contenido')
    expect(buildContenidoPageUrl({ namespace: 'all', status: 'all' }, 1)).toBe('/admin/contenido')
  })

  test('includes only set, non-default params + page > 1', () => {
    const url = buildContenidoPageUrl({ q: 'autos', namespace: 'sellerAcquisition', status: 'overridden' }, 3)
    expect(url).toBe('/admin/contenido?q=autos&namespace=sellerAcquisition&status=overridden&page=3')
  })
})
