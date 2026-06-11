import { test, expect } from '@playwright/test'
import { DELETED_STATUS, isDeletedStatus, filterOutDeleted } from '../lib/listing-lifecycle'

// Pure state-mapping spec for the seller listing-delete lifecycle (S2). A
// soft-deleted product (Medusa `deleted_at`) carries `status: 'deleted'` in the
// mirror, and the manage grid must agree "gone" with the mirror + edit guard —
// hiding it AND keeping it out of the resync that would otherwise clobber the
// mirror back to 'draft'. No auth, no network — coverage for free.

test.describe('listing-lifecycle · isDeletedStatus', () => {
  test('only "deleted" is deleted', () => {
    expect(isDeletedStatus(DELETED_STATUS)).toBe(true)
    expect(isDeletedStatus('deleted')).toBe(true)
  })

  test('every live/visible status is not deleted', () => {
    for (const status of ['active', 'paused', 'draft', 'published', '', null, undefined]) {
      expect(isDeletedStatus(status)).toBe(false)
    }
  })
})

test.describe('listing-lifecycle · filterOutDeleted', () => {
  const grid = [
    { id: 'prod_A', title: 'Kept active' },
    { id: 'prod_B', title: 'Drafted-but-deleted' },
    { id: 'prod_C', title: 'Kept paused' },
  ]

  test('drops listings whose id is in the deleted set (hidden from grid + resync)', () => {
    const out = filterOutDeleted(grid, new Set(['prod_B']))
    expect(out.map((l) => l.id)).toEqual(['prod_A', 'prod_C'])
  })

  test('an empty deleted set is a no-op (returns the same listings)', () => {
    const out = filterOutDeleted(grid, new Set())
    expect(out).toBe(grid)
  })

  test('a deleted id absent from the grid changes nothing', () => {
    const out = filterOutDeleted(grid, new Set(['prod_ZZZ']))
    expect(out.map((l) => l.id)).toEqual(['prod_A', 'prod_B', 'prod_C'])
  })

  test('removes every listing when all are deleted', () => {
    const out = filterOutDeleted(grid, new Set(['prod_A', 'prod_B', 'prod_C']))
    expect(out).toEqual([])
  })
})
