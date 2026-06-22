import { expect, test } from '@playwright/test'
import {
  priceLabel,
  favoriteConditionLabel,
  sellerModule,
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

  test('sellerModule picks snapshot only with a shop AND stats, else recruit', () => {
    const snap = { shopName: 'Tienda', visitas: 4, ofertasNuevas: 1 }
    expect(sellerModule({ hasShop: true, sellerSnapshot: snap })).toBe('snapshot')
    // Has a flag but no stats payload → recruit (defensive: never a blank snapshot).
    expect(sellerModule({ hasShop: true, sellerSnapshot: null })).toBe('recruit')
    expect(sellerModule({ hasShop: false, sellerSnapshot: null })).toBe('recruit')
    // hasShop:false with stale stats still recruits (hasShop is authoritative).
    expect(sellerModule({ hasShop: false, sellerSnapshot: snap })).toBe('recruit')
  })
})
