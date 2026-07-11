import { test, expect } from '@playwright/test'
import {
  sortFlagsByKey,
  sortFlags,
  filterFlagsByQuery,
  filterFlagsByStatus,
  filterFlagsByPolarity,
  paginate,
  buildFlagsPageUrl,
} from '../lib/flags-admin-view'

/**
 * admin-flags-cleanup chore — pure display-ordering logic (api gate, no browser).
 * `sortFlags`/`filterFlagsBy*`/`buildFlagsPageUrl` added by the filter/sort/pagination
 * fast-follow — the flags list grew past 25+ with no search, no re-sort option, and
 * bottom-only pagination.
 */

test.describe('sortFlagsByKey', () => {
  test('sorts alphabetically by key, ascending', () => {
    const input = [{ key: 'ml.sync_enabled' }, { key: 'checkout.stripe_enabled' }, { key: 'pdp_redesign' }]
    expect(sortFlagsByKey(input).map(f => f.key)).toEqual([
      'checkout.stripe_enabled', 'ml.sync_enabled', 'pdp_redesign',
    ])
  })

  test('does not mutate the input array', () => {
    const input = [{ key: 'b' }, { key: 'a' }]
    const original = [...input]
    sortFlagsByKey(input)
    expect(input).toEqual(original)
  })

  test('empty list stays empty', () => {
    expect(sortFlagsByKey([])).toEqual([])
  })
})

test.describe('paginate', () => {
  const items = Array.from({ length: 27 }, (_, i) => ({ key: `flag.${i}` }))

  test('splits into pages of the given size', () => {
    const p1 = paginate(items, 1, 15)
    expect(p1.pageItems).toHaveLength(15)
    expect(p1.totalPages).toBe(2)
    expect(p1.page).toBe(1)

    const p2 = paginate(items, 2, 15)
    expect(p2.pageItems).toHaveLength(12)
    expect(p2.page).toBe(2)
  })

  test('clamps a page number below 1 up to page 1', () => {
    const result = paginate(items, 0, 15)
    expect(result.page).toBe(1)
    expect(result.pageItems).toHaveLength(15)
  })

  test('clamps a page number past the last page down to the last page', () => {
    const result = paginate(items, 99, 15)
    expect(result.page).toBe(2)
    expect(result.pageItems).toHaveLength(12)
  })

  test('an empty list is always exactly 1 page (no divide-by-zero)', () => {
    const result = paginate([], 1, 15)
    expect(result.totalPages).toBe(1)
    expect(result.pageItems).toEqual([])
  })

  test('a list smaller than one page is entirely page 1', () => {
    const small = items.slice(0, 5)
    const result = paginate(small, 1, 15)
    expect(result.totalPages).toBe(1)
    expect(result.pageItems).toHaveLength(5)
  })
})

test.describe('sortFlags', () => {
  const flags = [
    { key: 'pdp_redesign', enabled: true, polarity: 'killswitch', updated_at: '2026-07-01T00:00:00Z' },
    { key: 'ml.sync_enabled', enabled: false, polarity: 'killswitch', updated_at: null },
    { key: 'checkout.stripe_enabled', enabled: true, polarity: 'killswitch', updated_at: '2026-07-11T00:00:00Z' },
    { key: 'domain.paywall_enabled', enabled: false, polarity: 'enablement', updated_at: '2026-07-05T00:00:00Z' },
  ]

  test('key_asc matches sortFlagsByKey', () => {
    expect(sortFlags(flags, 'key_asc').map(f => f.key)).toEqual(sortFlagsByKey(flags).map(f => f.key))
  })

  test('key_desc reverses alphabetical order', () => {
    expect(sortFlags(flags, 'key_desc').map(f => f.key)).toEqual([
      'pdp_redesign', 'ml.sync_enabled', 'domain.paywall_enabled', 'checkout.stripe_enabled',
    ])
  })

  test('status sorts enabled flags first, alphabetical tiebreak within each group', () => {
    expect(sortFlags(flags, 'status').map(f => f.key)).toEqual([
      'checkout.stripe_enabled', 'pdp_redesign', // enabled, alphabetical
      'domain.paywall_enabled', 'ml.sync_enabled', // disabled, alphabetical
    ])
  })

  test('polarity sorts kill-switch before enablement, alphabetical tiebreak within each', () => {
    expect(sortFlags(flags, 'polarity').map(f => f.key)).toEqual([
      'checkout.stripe_enabled', 'ml.sync_enabled', 'pdp_redesign', // killswitch, alphabetical
      'domain.paywall_enabled', // enablement
    ])
  })

  test('recent sorts by updated_at descending, never-updated rows sort last', () => {
    expect(sortFlags(flags, 'recent').map(f => f.key)).toEqual([
      'checkout.stripe_enabled', // 07-11
      'domain.paywall_enabled', // 07-05
      'pdp_redesign', // 07-01
      'ml.sync_enabled', // null — last
    ])
  })

  test('does not mutate the input array', () => {
    const original = [...flags]
    sortFlags(flags, 'recent')
    expect(flags).toEqual(original)
  })
})

test.describe('filterFlagsByQuery', () => {
  const flags = [
    { key: 'checkout.stripe_enabled', description: 'Pagos con tarjeta vía Stripe.' },
    { key: 'ml.sync_enabled', description: 'Sincronización de inventario con Mercado Libre.' },
    { key: 'pdp_redesign', description: null },
  ]

  test('empty query returns every flag, unfiltered', () => {
    expect(filterFlagsByQuery(flags, '').map(f => f.key)).toHaveLength(3)
  })

  test('matches a substring of the key, case-insensitive', () => {
    expect(filterFlagsByQuery(flags, 'STRIPE').map(f => f.key)).toEqual(['checkout.stripe_enabled'])
  })

  test('matches a substring of the description, case-insensitive', () => {
    expect(filterFlagsByQuery(flags, 'mercado libre').map(f => f.key)).toEqual(['ml.sync_enabled'])
  })

  test('a null description never throws — just doesn\'t match on text', () => {
    expect(filterFlagsByQuery(flags, 'redesign').map(f => f.key)).toEqual(['pdp_redesign'])
    expect(() => filterFlagsByQuery(flags, 'no existe')).not.toThrow()
  })

  test('no match returns an empty list', () => {
    expect(filterFlagsByQuery(flags, 'no existe ningún flag así')).toEqual([])
  })
})

test.describe('filterFlagsByStatus', () => {
  const flags = [{ key: 'a', enabled: true }, { key: 'b', enabled: false }, { key: 'c', enabled: true }]

  test('"all" returns every flag', () => {
    expect(filterFlagsByStatus(flags, 'all')).toHaveLength(3)
  })
  test('"on" keeps only enabled flags', () => {
    expect(filterFlagsByStatus(flags, 'on').map(f => f.key)).toEqual(['a', 'c'])
  })
  test('"off" keeps only disabled flags', () => {
    expect(filterFlagsByStatus(flags, 'off').map(f => f.key)).toEqual(['b'])
  })
})

test.describe('filterFlagsByPolarity', () => {
  const flags = [
    { key: 'a', polarity: 'killswitch' },
    { key: 'b', polarity: 'enablement' },
    { key: 'c', polarity: 'killswitch' },
  ]

  test('"all" returns every flag', () => {
    expect(filterFlagsByPolarity(flags, 'all')).toHaveLength(3)
  })
  test('"killswitch" keeps only kill-switch flags', () => {
    expect(filterFlagsByPolarity(flags, 'killswitch').map(f => f.key)).toEqual(['a', 'c'])
  })
  test('"enablement" keeps only enablement flags', () => {
    expect(filterFlagsByPolarity(flags, 'enablement').map(f => f.key)).toEqual(['b'])
  })
})

test.describe('buildFlagsPageUrl', () => {
  test('no params, page 1 → the bare path', () => {
    expect(buildFlagsPageUrl({}, 1)).toBe('/admin/flags')
  })

  test('page > 1 adds a page param', () => {
    expect(buildFlagsPageUrl({}, 3)).toBe('/admin/flags?page=3')
  })

  test('carries q/status/polarity/sort, drops empty and "all" values', () => {
    const url = buildFlagsPageUrl({ q: 'stripe', status: 'on', polarity: 'all', sort: 'recent' }, 1)
    expect(url).toContain('q=stripe')
    expect(url).toContain('status=on')
    expect(url).toContain('sort=recent')
    expect(url).not.toContain('polarity')
  })

  test('an explicit "all" status is dropped, same as undefined', () => {
    expect(buildFlagsPageUrl({ status: 'all' }, 1)).toBe('/admin/flags')
  })
})
