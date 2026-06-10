import { test, expect } from '@playwright/test'
import { wrapIndex, indexFromScroll } from '../lib/gallery'

/**
 * PDP gallery — pure index math (api gate, no browser). The Gallery island and
 * its lightbox both read these, so wrap/clamp behaviour can't drift between them.
 */
test.describe('gallery · wrapIndex', () => {
  test('wraps past the ends (prev-from-first → last, next-from-last → first)', () => {
    expect(wrapIndex(-1, 5)).toBe(4)
    expect(wrapIndex(5, 5)).toBe(0)
    expect(wrapIndex(6, 5)).toBe(1)
  })

  test('is identity inside range and survives big jumps', () => {
    expect(wrapIndex(0, 5)).toBe(0)
    expect(wrapIndex(3, 5)).toBe(3)
    expect(wrapIndex(-7, 5)).toBe(3)
  })

  test('returns 0 for an empty gallery (no divide-by-zero)', () => {
    expect(wrapIndex(2, 0)).toBe(0)
    expect(wrapIndex(-1, 0)).toBe(0)
  })
})

test.describe('gallery · indexFromScroll', () => {
  test('rounds scrollLeft / slideWidth to the nearest slide', () => {
    expect(indexFromScroll(0, 300, 4)).toBe(0)
    expect(indexFromScroll(140, 300, 4)).toBe(0) // <half → still slide 0
    expect(indexFromScroll(160, 300, 4)).toBe(1) // >half → slide 1
    expect(indexFromScroll(600, 300, 4)).toBe(2)
  })

  test('clamps to the last slide and never goes negative', () => {
    expect(indexFromScroll(9999, 300, 4)).toBe(3)
    expect(indexFromScroll(-50, 300, 4)).toBe(0)
  })

  test('returns 0 for degenerate inputs (zero-width / empty track)', () => {
    expect(indexFromScroll(500, 0, 4)).toBe(0)
    expect(indexFromScroll(500, 300, 0)).toBe(0)
  })
})
