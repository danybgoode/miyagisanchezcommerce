import { test, expect } from '@playwright/test'
import { isBoundaryDeniedPath } from '../lib/route-shape'

/**
 * Own-shop premium presentation · Sprint 3, Story 3.1 — regression guard for
 * middleware.ts's boundary-isolation deny-list, mirroring
 * `collection-route-passthrough.spec.ts`. There is no allow-list to extend
 * for `/acerca`, `/faq`, `/politicas` (the model is inverted: every path
 * passes through untouched except this small deny-list) — this spec locks
 * that none of the three are ever caught by it, sharing the exact predicate
 * middleware.ts calls (`isBoundaryDeniedPath`) so a future edit to the
 * deny-list can't silently start blocking shop content pages without this
 * spec catching it.
 */

test.describe('boundary-isolation deny-list — shop content pages must always pass through', () => {
  test('acerca/faq/politicas are never denied', () => {
    expect(isBoundaryDeniedPath('/acerca')).toBe(false)
    expect(isBoundaryDeniedPath('/faq')).toBe(false)
    expect(isBoundaryDeniedPath('/politicas')).toBe(false)
  })

  test('the deny-list still catches /s and /l paths (regression baseline)', () => {
    expect(isBoundaryDeniedPath('/s')).toBe(true)
    expect(isBoundaryDeniedPath('/s/some-shop')).toBe(true)
    expect(isBoundaryDeniedPath('/l')).toBe(true)
    expect(isBoundaryDeniedPath('/l/')).toBe(true)
  })

  test('a path that merely shares a prefix without a boundary slash is NOT denied', () => {
    expect(isBoundaryDeniedPath('/acercade')).toBe(false)
    expect(isBoundaryDeniedPath('/faqs')).toBe(false)
  })
})
