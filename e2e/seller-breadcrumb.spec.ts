import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sellerBreadcrumbTrail } from '../lib/seller-nav'

/**
 * Seller breadcrumb deriver — pure logic (api gate, no browser). `<SellerBreadcrumb>`
 * renders whatever this returns, and the section label is looked up from the nav
 * SSOT (`SELLER_NAV`), so the breadcrumb can't drift from the rail. Every route
 * asserted here is a real `/shop/manage/*` page (kept in lockstep with the rail).
 */

const HOME = { label: 'Resumen', href: '/shop/manage' }

test.describe('sellerBreadcrumbTrail · flat two-part sections', () => {
  test('the dashboard is a single Resumen crumb (current page)', () => {
    expect(sellerBreadcrumbTrail('/shop/manage')).toEqual([{ label: 'Resumen', href: null }])
  })

  test('each section → "Resumen / <canonical label>" with the section as current', () => {
    const cases: Record<string, string> = {
      '/shop/manage/orders': 'Pedidos',
      '/shop/manage/offers': 'Ofertas',
      '/shop/manage/analytics': 'Analíticas',
      '/shop/manage/promotions': 'Cupones',
      '/shop/manage/subscriptions': 'Suscripciones',
      '/shop/manage/content': 'Contenido',
      '/shop/manage/import': 'Importar catálogo',
      '/shop/manage/settings': 'Configuración',
      '/shop/manage/eventos': 'Eventos',
      '/shop/manage/sweepstakes': 'Sorteos',
    }
    for (const [pathname, label] of Object.entries(cases)) {
      expect(sellerBreadcrumbTrail(pathname), pathname).toEqual([
        HOME,
        { label, href: null },
      ])
    }
  })
})

test.describe('sellerBreadcrumbTrail · deeper pages keep the intermediate link', () => {
  test('order detail → Resumen / Pedidos / <id>, Pedidos still a link', () => {
    expect(
      sellerBreadcrumbTrail('/shop/manage/orders/ord_42', [{ label: 'ord_42aa…', href: null }]),
    ).toEqual([
      HOME,
      { label: 'Pedidos', href: '/shop/manage/orders' },
      { label: 'ord_42aa…', href: null },
    ])
  })

  test('settings sub-section → Resumen / Configuración / <section>, Configuración still a link', () => {
    expect(
      sellerBreadcrumbTrail('/shop/manage/settings/pagos', [{ label: 'Pagos', href: null }]),
    ).toEqual([
      HOME,
      { label: 'Configuración', href: '/shop/manage/settings' },
      { label: 'Pagos', href: null },
    ])
  })

  test('the last crumb is always the current page (href null); earlier crumbs keep links', () => {
    const trail = sellerBreadcrumbTrail('/shop/manage/orders/ord_42', [{ label: 'x', href: '/should/be/dropped' }])
    expect(trail[trail.length - 1].href).toBeNull()
    expect(trail[0].href).toBe('/shop/manage')
    expect(trail[1].href).toBe('/shop/manage/orders')
  })
})

test.describe('sellerBreadcrumbTrail · off-surface', () => {
  test('a non-manage pathname degrades to just Resumen', () => {
    expect(sellerBreadcrumbTrail('/account')).toEqual([{ label: 'Resumen', href: null }])
    expect(sellerBreadcrumbTrail('/')).toEqual([{ label: 'Resumen', href: null }])
    expect(sellerBreadcrumbTrail('')).toEqual([{ label: 'Resumen', href: null }])
  })
})

/**
 * Anti-erosion guard (same idiom as the raw-color / monolith guards): once every
 * `/shop/manage/*` section renders <SellerBreadcrumb>, no bespoke back-link may
 * reappear. Scans the source tree and fails CI if any banned affordance returns.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const MANAGE_DIR = join(repoRoot, 'app', '(shell)', 'shop', 'manage')
const BANNED_BACKLINKS = ['← Panel', '← Mi tienda', '← Volver al panel', '← Pedidos']

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

test.describe('seller breadcrumb · anti-erosion guard', () => {
  test('no bespoke back-link affordance remains under app/(shell)/shop/manage', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(MANAGE_DIR)) {
      const src = readFileSync(file, 'utf8')
      for (const banned of BANNED_BACKLINKS) {
        if (src.includes(banned)) offenders.push(`${file.replace(MANAGE_DIR, 'manage')} → "${banned}"`)
      }
    }
    expect(offenders, `bespoke back-links must use <SellerBreadcrumb>:\n${offenders.join('\n')}`).toEqual([])
  })
})
