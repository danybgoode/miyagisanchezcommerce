import { test, expect } from '@playwright/test'
import { sortFlagsByKey, paginate } from '../lib/flags-admin-view'

/**
 * admin-flags-cleanup chore — pure display-ordering logic (api gate, no browser).
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
