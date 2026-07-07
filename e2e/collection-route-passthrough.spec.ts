import { test, expect } from '@playwright/test'
import { isBoundaryDeniedPath } from '../lib/route-shape'

/**
 * Own-shop premium presentation · Sprint 2, Story 2.2 — regression guard for
 * middleware.ts's boundary-isolation deny-list. There is no allow-list to
 * extend for `/c/[collection]` (the model is inverted: every path passes
 * through untouched except this small deny-list) — this spec instead locks
 * that `/c/*` is NEVER caught by it, sharing the exact predicate
 * middleware.ts calls (`isBoundaryDeniedPath`) so a future edit to the
 * deny-list can't silently start blocking collections without this spec
 * catching it.
 */

test.describe('boundary-isolation deny-list — /c/[collection] must always pass through', () => {
  test('a collection path is never denied', () => {
    expect(isBoundaryDeniedPath('/c/die-cut')).toBe(false)
    expect(isBoundaryDeniedPath('/c/zines')).toBe(false)
  })

  test('the deny-list still catches /s and /l paths (regression baseline)', () => {
    expect(isBoundaryDeniedPath('/s')).toBe(true)
    expect(isBoundaryDeniedPath('/s/some-shop')).toBe(true)
    expect(isBoundaryDeniedPath('/l')).toBe(true)
    expect(isBoundaryDeniedPath('/l/')).toBe(true)
  })

  test('a path that merely shares the /l or /s prefix without a boundary slash is NOT denied', () => {
    // e.g. a hypothetical /listings or /shop route must not be swept in by a
    // loose prefix match — same discipline as isSellerModePath's own guard.
    expect(isBoundaryDeniedPath('/listings')).toBe(false)
    expect(isBoundaryDeniedPath('/shop')).toBe(false)
  })
})
