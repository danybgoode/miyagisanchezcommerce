/**
 * Seller-mode navigation config — pure, next-free.
 *
 * `SellerNav.tsx` renders the desktop left rail + mobile bar from this single
 * source; the api spec (`e2e/seller-mode.spec.ts`) asserts every entry maps to a
 * real `/shop/manage/*` page and that the active matcher resolves correctly — so
 * the nav can't drift from the routes or the test. No new pages are created here:
 * every href targets an existing manage sub-page (or the dashboard).
 *
 * Four rail groups: Operar / Catálogo / Crecer / Configuración (catalog-management
 * epic, Sprint 1 · Story 1.1). "Anuncios" now points at the real `/shop/manage/catalogo`
 * table (Sprint 1 · Story 1.2) instead of the old `/shop/manage#anuncios` jump-link —
 * the dashboard keeps only a compact summary card. "Precios" is deliberately NOT added
 * yet — that page ships in a later catalog-management sprint; the nav never links a 404.
 */

export interface SellerNavEntry {
  /** Stable id for keys/tests. */
  key: string
  /** es-MX label. */
  label: string
  /** Destination — an existing `/shop/manage*` route, optionally with a `#hash`. */
  href: string
  /** Iconoir class (icons are loaded globally in `app/layout.tsx`). */
  icon: string
}

export interface SellerNavGroup {
  key: string
  label: string
  entries: SellerNavEntry[]
}

export const SELLER_NAV: SellerNavGroup[] = [
  {
    key: 'operar',
    label: 'Operar',
    entries: [
      { key: 'resumen', label: 'Resumen', href: '/shop/manage', icon: 'iconoir-dashboard-dots' },
      { key: 'pedidos', label: 'Pedidos', href: '/shop/manage/orders', icon: 'iconoir-package' },
      { key: 'ofertas', label: 'Ofertas', href: '/shop/manage/offers', icon: 'iconoir-hand-cash' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo',
    entries: [
      { key: 'anuncios', label: 'Anuncios', href: '/shop/manage/catalogo', icon: 'iconoir-pricetags' },
      { key: 'colecciones', label: 'Colecciones', href: '/shop/manage/collections', icon: 'iconoir-view-grid' },
      // Renamed from "Mercado Libre" — same page, now framed as the channels hub
      // (catalog-management epic: "ML becomes 'Canales'").
      { key: 'canales', label: 'Canales', href: '/shop/manage/mercadolibre', icon: 'iconoir-shop' },
      { key: 'importar', label: 'Importar catálogo', href: '/shop/manage/import', icon: 'iconoir-cloud-upload' },
    ],
  },
  {
    key: 'crecer',
    label: 'Crecer',
    entries: [
      { key: 'promociones', label: 'Cupones', href: '/shop/manage/promotions', icon: 'iconoir-percentage-circle' },
      { key: 'suscripciones', label: 'Suscripciones', href: '/shop/manage/subscriptions', icon: 'iconoir-refresh-double' },
      { key: 'contenido', label: 'Contenido', href: '/shop/manage/content', icon: 'iconoir-book' },
      { key: 'eventos', label: 'Eventos', href: '/shop/manage/eventos', icon: 'iconoir-calendar' },
      { key: 'sorteos', label: 'Sorteos', href: '/shop/manage/sweepstakes', icon: 'iconoir-gift' },
      { key: 'analitica', label: 'Analíticas', href: '/shop/manage/analytics', icon: 'iconoir-graph-up' },
      // Behind ops.profit_enabled: the page itself notFound()s while the flag
      // is OFF (profit-analyzer S1 · US-3) — the nav entry is harmless dark.
      { key: 'ganancias', label: 'Ganancias', href: '/shop/manage/profit', icon: 'iconoir-coins' },
    ],
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    entries: [
      { key: 'ajustes', label: 'Configuración', href: '/shop/manage/settings', icon: 'iconoir-settings' },
    ],
  },
]

/**
 * Mobile bottom bar = Resumen · Pedidos · Ofertas · Anuncios (unchanged from
 * before the Catálogo split — Anuncios stays one tap away even though it now
 * lives in the Catálogo group object) plus a "Más" disclosure. The overflow
 * behind "Más" is the rest of Catálogo, then Crecer, then Configuración.
 */
export const SELLER_NAV_MOBILE_PRIMARY: SellerNavEntry[] = [
  ...SELLER_NAV[0].entries,
  SELLER_NAV[1].entries[0],
]
export const SELLER_NAV_MOBILE_OVERFLOW: SellerNavEntry[] = [
  ...SELLER_NAV[1].entries.slice(1),
  ...SELLER_NAV[2].entries,
  ...SELLER_NAV[3].entries,
]

/** Pathname portion of an href (drops any `#hash`). */
function hrefPath(href: string): string {
  const hash = href.indexOf('#')
  return hash === -1 ? href : href.slice(0, hash)
}

/**
 * The single active entry href for a pathname. Longest pathname-prefix wins
 * (so `/shop/manage/orders` highlights Pedidos, not Resumen, and
 * `/shop/manage/catalogo` highlights Anuncios, not Resumen); ties resolve to
 * the first declared. Returns null when nothing matches.
 */
export function activeSellerNavHref(pathname: string): string | null {
  if (!pathname) return null
  let best: { href: string; len: number } | null = null
  for (const group of SELLER_NAV) {
    for (const entry of group.entries) {
      const base = hrefPath(entry.href)
      const matches = pathname === base || pathname.startsWith(base + '/')
      if (!matches) continue
      // Strict `>` keeps the first-declared entry on an equal-length tie.
      if (!best || base.length > best.len) best = { href: entry.href, len: base.length }
    }
  }
  return best?.href ?? null
}

/** One crumb in a seller breadcrumb trail. `href: null` = the current page (not a link). */
export interface SellerCrumb {
  label: string
  href: string | null
}

const DASHBOARD_HREF = '/shop/manage'

/** The nav entry whose route owns this pathname (canonical label lookup). */
function activeSellerNavEntry(pathname: string): SellerNavEntry | null {
  const href = activeSellerNavHref(pathname)
  if (!href) return null
  for (const group of SELLER_NAV) {
    for (const entry of group.entries) {
      if (entry.href === href) return entry
    }
  }
  return null
}

/**
 * The "Resumen / <Section>" breadcrumb trail for a `/shop/manage*` pathname,
 * derived from the same nav SSOT as the rail — so the section label is always the
 * canonical rail label and the two can't drift. On the dashboard (or off the
 * seller surface) it returns the single Resumen crumb.
 *
 * `extra` appends deeper crumbs after the section (e.g. an order id, or a settings
 * sub-section title). The LAST crumb of the returned trail always has `href: null`
 * (it's the current page); every crumb before it keeps its link.
 */
export function sellerBreadcrumbTrail(pathname: string, extra: SellerCrumb[] = []): SellerCrumb[] {
  const trail: SellerCrumb[] = [{ label: 'Resumen', href: DASHBOARD_HREF }]
  const entry = activeSellerNavEntry(pathname)
  // Skip the Resumen entry itself (it'd just duplicate the home crumb).
  if (entry && hrefPath(entry.href) !== DASHBOARD_HREF) {
    trail.push({ label: entry.label, href: hrefPath(entry.href) })
  }
  trail.push(...extra)
  // The page you're on is never a link.
  trail[trail.length - 1] = { ...trail[trail.length - 1], href: null }
  return trail
}
