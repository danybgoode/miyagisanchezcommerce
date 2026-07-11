import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { isSellerModePath } from '../lib/seller-mode'
import {
  SELLER_NAV,
  SELLER_NAV_MOBILE_PRIMARY,
  SELLER_NAV_MOBILE_OVERFLOW,
  activeSellerNavHref,
} from '../lib/seller-nav'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

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

// ── R2 — one .btn-primary per view ──────────────────────────────────────────

/**
 * `/shop/manage` and `/shop/manage/orders` are Clerk-gated, so an anonymous
 * `request` fixture hit just redirects to /sign-in — there's no rendered HTML
 * to grep. Instead this statically scans the route's own source files for
 * `btn-primary` occurrences, mirroring `lib/design-token-audit.ts`'s file-scan
 * pattern. This is an APPROXIMATION: it counts JSX occurrences in source, not
 * what actually renders for a given order/listing at runtime (conditional
 * branches that never render simultaneously are still counted together).
 *
 * Counts BOTH the raw `.btn-primary` class string AND `<Button variant="primary">`
 * usage — once a route adopts the shared `<Button>` component (Sprint 2's
 * adoption sweep), the literal string "btn-primary" moves into Button.tsx's
 * own source and stops appearing in the route file at all, which would
 * silently defeat a class-string-only scan (always counting 0).
 */
function countBtnPrimaryInSource(content: string): number {
  const rawClass = (content.match(/\bbtn-primary\b/g) ?? []).length
  const buttonComponent = (content.match(/<Button\b[^>]*\bvariant=["']primary["']/g) ?? []).length
  return rawClass + buttonComponent
}

async function countBtnPrimary(relPaths: string[]): Promise<number> {
  let total = 0
  for (const relPath of relPaths) {
    const content = await readFile(path.join(repoRoot, relPath), 'utf8')
    total += countBtnPrimaryInSource(content)
  }
  return total
}

/**
 * Per-step/per-section scan for a file whose whole-file `.btn-primary` count is
 * NOT ≤1 by design — e.g. a multi-step wizard where each step has its own primary
 * CTA, but only one step ever renders at a time. Slices the source between each
 * named top-level function's declaration and the next one (or EOF), so a real
 * regression (two primary buttons within the SAME step/section) still fails,
 * without the whole-file total falsely tripping the assertion.
 */
async function countBtnPrimaryPerFunction(relPath: string, functionNames: string[]): Promise<Record<string, number>> {
  const content = await readFile(path.join(repoRoot, relPath), 'utf8')
  const starts = functionNames
    .map((name) => ({ name, index: content.indexOf(`function ${name}(`) }))
    .filter((f) => f.index !== -1)
    .sort((a, b) => a.index - b.index)

  const counts: Record<string, number> = {}
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index
    const to = i + 1 < starts.length ? starts[i + 1].index : content.length
    counts[starts[i].name] = countBtnPrimaryInSource(content.slice(from, to))
  }
  return counts
}

test.describe('seller-mode · R2 one .btn-primary per view (static source scan)', () => {
  test('/shop/manage renders at most one .btn-primary', async () => {
    const count = await countBtnPrimary([
      'app/(shell)/shop/manage/page.tsx',
      'app/(shell)/shop/manage/ManageDashboard.tsx',
    ])
    expect(count).toBeLessThanOrEqual(1)
  })

  test('/shop/manage/orders renders at most one .btn-primary', async () => {
    const count = await countBtnPrimary([
      'app/(shell)/shop/manage/orders/page.tsx',
      'app/(shell)/shop/manage/orders/OrdersInbox.tsx',
      'app/(shell)/shop/manage/orders/[id]/page.tsx',
      'app/(shell)/shop/manage/orders/[id]/OrderDetail.tsx',
    ])
    expect(count).toBeLessThanOrEqual(1)
  })

  // seller-portal-rails-foundation S2 · Story 2.1 adoption sweep — newly-swept routes.
  test('/shop/manage/offers renders at most one .btn-primary', async () => {
    const count = await countBtnPrimary([
      'app/(shell)/shop/manage/offers/page.tsx',
      'app/(shell)/shop/manage/offers/OfferInbox.tsx',
    ])
    expect(count).toBeLessThanOrEqual(1)
  })

  // /sell (SellWizard) is a 3-step wizard — only one step ever renders at once, so
  // the assertion is per-step, not whole-file (StepShop/StepListing each have their
  // own "Continue"/"Publish" CTA; StepSuccess has its own primary CTA anchor).
  test('/sell renders at most one primary CTA per wizard step', async () => {
    const counts = await countBtnPrimaryPerFunction('app/(shell)/sell/SellWizard.tsx', [
      'StepShop', 'StepListing', 'StepSuccess',
    ])
    expect(Object.keys(counts)).toEqual(['StepShop', 'StepListing', 'StepSuccess'])
    for (const [step, count] of Object.entries(counts)) {
      expect(count, `${step} primary CTA count`).toBeLessThanOrEqual(1)
    }
  })

  // /sell/setup (SetupClient) is NOT covered by an equivalent per-section count:
  // FirstRunApply alone has 2 mutually-exclusive conditional states (paste form vs
  // staging preview) inside one function, so a function-boundary slice can't tell
  // them apart without parsing the JSX conditionals themselves — not worth building
  // for this static-scan APPROXIMATION (see the file-level docstring above).
})
