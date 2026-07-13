import { expect, test } from '@playwright/test'
import {
  priceLabel,
  favoriteConditionLabel,
  sellerModule,
  logPersonalizationFetchFailure,
  derivePriceDrop,
} from '../lib/home-personalization'

/**
 * Marketplace static-shell — Sprint 4 (Story 4.1). The homepage personalization islands
 * derive their es-MX copy + module choice through the next-free `lib/home-personalization.ts`
 * seam, so this proves the pure logic without auth/network. The islands themselves only
 * add the client fetch that feeds these helpers (covered by the browser spec).
 */

test.describe('home-personalization · pure helpers', () => {
  test('priceLabel formats centavos as es-MX currency, null → consultar', () => {
    expect(priceLabel(150000, 'MXN')).toContain('1,500')
    expect(priceLabel(150000, 'MXN')).toContain('$')
    expect(priceLabel(99, 'MXN')).toContain('0.99')
    expect(priceLabel(null, 'MXN')).toBe('Precio a consultar')
    // Honors the row's own currency.
    expect(priceLabel(2500, 'USD')).toContain('25')
    // A malformed currency from the wire must NOT throw (would blank the home render) —
    // it degrades to a plain amount (cross-review hardening).
    expect(() => priceLabel(150000, 'not-a-currency')).not.toThrow()
    expect(priceLabel(150000, 'not-a-currency')).toContain('1,500')
  })

  test('favoriteConditionLabel maps known conditions, degrades safely', () => {
    expect(favoriteConditionLabel('new')).toBe('Nuevo')
    expect(favoriteConditionLabel('like_new')).toBe('Como nuevo')
    expect(favoriteConditionLabel('good')).toBe('Buen estado')
    expect(favoriteConditionLabel('fair')).toBe('Aceptable')
    expect(favoriteConditionLabel('parts')).toBe('Para piezas')
    // Unknown passes through; null → empty (no orphan dot in the meta line).
    expect(favoriteConditionLabel('refurbished')).toBe('refurbished')
    expect(favoriteConditionLabel(null)).toBe('')
  })

  test('sellerModule: a shop owner never gets the recruit card (hasShop authoritative)', () => {
    const snap = { shopName: 'Tienda', visitas: 4, ofertasNuevas: 1 }
    expect(sellerModule({ hasShop: true, sellerSnapshot: snap })).toBe('snapshot')
    // Owns a shop but no stats payload yet → render nothing, NEVER recruit (the bug).
    expect(sellerModule({ hasShop: true, sellerSnapshot: null })).toBe('none')
    // No shop → recruit.
    expect(sellerModule({ hasShop: false, sellerSnapshot: null })).toBe('recruit')
    // hasShop:false with stale stats still recruits (hasShop is authoritative).
    expect(sellerModule({ hasShop: false, sellerSnapshot: snap })).toBe('recruit')
  })

  test('derivePriceDrop (S2.2 badge) — mirrors the /account/favorites comparison exactly', () => {
    // A real drop: snapshot was higher than the current price.
    expect(derivePriceDrop(30000, 25000)).toEqual({ dropped: true, dropAmountCents: 5000 })
    // No snapshot (favorite saved before the column existed) — no badge, no crash.
    expect(derivePriceDrop(null, 25000)).toEqual({ dropped: false, dropAmountCents: 0 })
    // Same price — not a drop.
    expect(derivePriceDrop(25000, 25000)).toEqual({ dropped: false, dropAmountCents: 0 })
    // Price went UP since favoriting — not a drop.
    expect(derivePriceDrop(25000, 30000)).toEqual({ dropped: false, dropAmountCents: 0 })
    // Listing price itself missing ("Precio a consultar") — no crash, no badge.
    expect(derivePriceDrop(25000, null)).toEqual({ dropped: false, dropAmountCents: 0 })
  })

  test('logPersonalizationFetchFailure (S1.3 breadcrumb) — warns exactly once per call, with the reason', () => {
    const original = console.warn
    const calls: unknown[][] = []
    console.warn = (...args: unknown[]) => {
      calls.push(args)
    }
    try {
      // Success path: the provider never calls this helper at all — nothing to assert
      // beyond "not called", which the fresh `calls` array already guarantees below.

      // Non-ok response (e.g. a 401/404/500) — logs the status.
      logPersonalizationFetchFailure(500)
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toBe('[home-personalization] fetch failed')
      expect(calls[0][1]).toBe(500)

      // Thrown/network error — logs the error, still exactly once.
      const err = new Error('network down')
      logPersonalizationFetchFailure(err)
      expect(calls).toHaveLength(2)
      expect(calls[1][1]).toBe(err)
    } finally {
      console.warn = original
    }
  })
})
