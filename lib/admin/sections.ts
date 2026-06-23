/**
 * Admin section registry — the nav SSOT, pure & next-free.
 *
 * `AdminShell.tsx` renders the left-nav + the `/admin` hub from this single
 * source; the api spec (`e2e/admin-sections.spec.ts`) asserts every internal
 * entry targets an `/admin/*` route and every external entry is an absolute
 * URL — so the nav can't drift from the routes or the test. Modeled on
 * `lib/seller-nav.ts`.
 *
 * Sprint 1 lists only the sections that exist today (Coupons, Print) plus the
 * external scraper link-out. Later sprints append supply / vecindario /
 * referrals / tenants / audit as those sections land.
 */

export type AdminRisk = 'low' | 'med' | 'high'

export interface AdminSection {
  /** Stable id for keys/tests. */
  key: string
  /** es-MX label. */
  label: string
  /** Short es-MX description for the hub card. */
  description: string
  /** Destination — an internal `/admin/*` route, or an absolute URL when `external`. */
  href: string
  /** Iconoir class (icons are loaded globally in `app/layout.tsx`). */
  icon: string
  /** Risk tier of the section's actions (informational in the nav). */
  risk: AdminRisk
  /** When true, `href` is an absolute URL that opens the external app. */
  external?: boolean
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: 'coupons',
    label: 'Cupones',
    description: 'Cupones de plataforma y configuración de referidos.',
    href: '/admin/coupons',
    icon: 'iconoir-percentage-circle',
    risk: 'med',
  },
  {
    key: 'print',
    label: 'Edición impresa',
    description: 'Revisa y aprueba anuncios para la edición impresa.',
    href: '/admin/print',
    icon: 'iconoir-printer',
    risk: 'med',
  },
  {
    key: 'scraping',
    label: 'Scraping',
    description: 'Abre la app externa de scraping de oferta.',
    href: 'https://miyagisanchez-scraper.vercel.app/admin',
    icon: 'iconoir-spark',
    risk: 'low',
    external: true,
  },
]

/** Pathname portion of an href (drops any `#hash`). */
function hrefPath(href: string): string {
  const hash = href.indexOf('#')
  return hash === -1 ? href : href.slice(0, hash)
}

/**
 * The single active section href for a pathname. Longest pathname-prefix wins
 * (so `/admin/coupons` highlights Cupones); external entries never match.
 * Returns null when nothing matches.
 */
export function activeAdminSectionHref(pathname: string): string | null {
  if (!pathname) return null
  let best: { href: string; len: number } | null = null
  for (const section of ADMIN_SECTIONS) {
    if (section.external) continue
    const base = hrefPath(section.href)
    const matches = pathname === base || pathname.startsWith(base + '/')
    if (!matches) continue
    if (!best || base.length > best.len) best = { href: section.href, len: base.length }
  }
  return best?.href ?? null
}
