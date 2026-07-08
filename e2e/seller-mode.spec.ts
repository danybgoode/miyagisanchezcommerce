import { test, expect } from '@playwright/test'
import { isSellerModePath } from '../lib/seller-mode'
import {
  SELLER_NAV,
  SELLER_NAV_MOBILE_PRIMARY,
  SELLER_NAV_MOBILE_OVERFLOW,
  activeSellerNavHref,
} from '../lib/seller-nav'

/**
 * Seller-mode shell — pure logic (api gate, no browser). The root layout reads
 * `isSellerModePath` to suppress buyer chrome and `SellerNav` reads the config +
 * matcher, so the suppression boundary and the nav can't drift from the test.
 *
 * Every `/shop/manage/*` route asserted here is confirmed present in the repo.
 */

// The real manage sub-pages a nav entry may legitimately target (besides the
// `/shop/manage` dashboard itself). Kept in lockstep with app/shop/manage/*.
const REAL_MANAGE_ROUTES = new Set([
  '/shop/manage',
  '/shop/manage/orders',
  '/shop/manage/offers',
  '/shop/manage/catalogo',
  '/shop/manage/analytics',
  '/shop/manage/profit',
  '/shop/manage/collections',
  '/shop/manage/promotions',
  '/shop/manage/subscriptions',
  '/shop/manage/content',
  '/shop/manage/eventos',
  '/shop/manage/sweepstakes',
  '/shop/manage/import',
  '/shop/manage/mercadolibre',
  '/shop/manage/settings',
])

function hrefPath(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

test.describe('seller-mode · isSellerModePath', () => {
  test('matches the manage surface and everything beneath it', () => {
    expect(isSellerModePath('/shop/manage')).toBe(true)
    expect(isSellerModePath('/shop/manage/orders')).toBe(true)
    expect(isSellerModePath('/shop/manage/orders/ord_42')).toBe(true)
    expect(isSellerModePath('/shop/manage/settings/payments')).toBe(true)
  })

  test('does not match buyer routes', () => {
    expect(isSellerModePath('/')).toBe(false)
    expect(isSellerModePath('/l')).toBe(false)
    expect(isSellerModePath('/l/abc')).toBe(false)
    expect(isSellerModePath('/account')).toBe(false)
    expect(isSellerModePath('/account/orders')).toBe(false)
    expect(isSellerModePath('/sell')).toBe(false)
    expect(isSellerModePath('/vecindario')).toBe(false)
    expect(isSellerModePath('')).toBe(false)
  })

  test('does not match a route that merely shares the prefix (no boundary slash)', () => {
    expect(isSellerModePath('/shop/managexyz')).toBe(false)
    expect(isSellerModePath('/shop/manager')).toBe(false)
    expect(isSellerModePath('/shop')).toBe(false)
  })
})

test.describe('seller-mode · SELLER_NAV config', () => {
  test('has the four expected groups in order', () => {
    expect(SELLER_NAV.map(g => g.label)).toEqual(['Operar', 'Catálogo', 'Crecer', 'Configuración'])
  })

  test('every entry targets a real manage route (no new pages)', () => {
    for (const group of SELLER_NAV) {
      for (const entry of group.entries) {
        expect(REAL_MANAGE_ROUTES.has(hrefPath(entry.href)), `${entry.label} → ${entry.href}`).toBe(true)
      }
    }
  })

  test('labels match the sprint spec', () => {
    expect(SELLER_NAV[0].entries.map(e => e.label)).toEqual(['Resumen', 'Pedidos', 'Ofertas'])
    expect(SELLER_NAV[1].entries.map(e => e.label)).toEqual(['Anuncios', 'Colecciones', 'Canales', 'Importar catálogo'])
    expect(SELLER_NAV[2].entries.map(e => e.label)).toEqual([
      'Cupones', 'Suscripciones', 'Contenido', 'Eventos', 'Sorteos', 'Analíticas', 'Ganancias',
    ])
    expect(SELLER_NAV[3].entries.map(e => e.label)).toEqual(['Configuración'])
  })

  test('mobile primary is Resumen · Pedidos · Ofertas · Anuncios; Más overflow is the rest', () => {
    expect(SELLER_NAV_MOBILE_PRIMARY.map(e => e.label)).toEqual(['Resumen', 'Pedidos', 'Ofertas', 'Anuncios'])
    expect(SELLER_NAV_MOBILE_OVERFLOW.length).toBeGreaterThan(0)
    expect(SELLER_NAV_MOBILE_OVERFLOW.map(e => e.label)).toEqual([
      'Colecciones', 'Canales', 'Importar catálogo',
      'Cupones', 'Suscripciones', 'Contenido', 'Eventos', 'Sorteos', 'Analíticas', 'Ganancias',
      'Configuración',
    ])
  })

  test('every entry has a stable key and an Iconoir class', () => {
    const keys = SELLER_NAV.flatMap(g => g.entries.map(e => e.key))
    expect(new Set(keys).size).toBe(keys.length) // unique
    for (const group of SELLER_NAV) {
      for (const entry of group.entries) {
        expect(entry.icon.startsWith('iconoir-')).toBe(true)
      }
    }
  })
})

test.describe('seller-mode · activeSellerNavHref', () => {
  test('dashboard highlights Resumen', () => {
    expect(activeSellerNavHref('/shop/manage')).toBe('/shop/manage')
  })

  test('a sub-page highlights its own entry by longest prefix', () => {
    expect(activeSellerNavHref('/shop/manage/orders')).toBe('/shop/manage/orders')
    expect(activeSellerNavHref('/shop/manage/orders/ord_42')).toBe('/shop/manage/orders')
    expect(activeSellerNavHref('/shop/manage/catalogo')).toBe('/shop/manage/catalogo')
    expect(activeSellerNavHref('/shop/manage/settings')).toBe('/shop/manage/settings')
    expect(activeSellerNavHref('/shop/manage/settings/payments')).toBe('/shop/manage/settings')
    expect(activeSellerNavHref('/shop/manage/analytics')).toBe('/shop/manage/analytics')
    expect(activeSellerNavHref('/shop/manage/subscriptions')).toBe('/shop/manage/subscriptions')
    expect(activeSellerNavHref('/shop/manage/content')).toBe('/shop/manage/content')
    expect(activeSellerNavHref('/shop/manage/sweepstakes')).toBe('/shop/manage/sweepstakes')
  })

  test('returns null off the seller surface', () => {
    expect(activeSellerNavHref('/account')).toBeNull()
    expect(activeSellerNavHref('/')).toBeNull()
    expect(activeSellerNavHref('')).toBeNull()
  })
})
