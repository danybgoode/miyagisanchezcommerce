/**
 * Canonical seller-section title guard — pure, next-free.
 *
 * seller-nav-consolidation picks one canonical name per destination
 * (lib/seller-nav.ts). The section *page titles* already match (Cupones /
 * Analíticas / Configuración / Importar catálogo), so this is an anti-erosion
 * guard, the same offender-finder shape as the raw-color / monolith guards: scan
 * each renamed section's sources and fail CI if an old standalone title reappears.
 *
 * `forbidden` matchers are tight to avoid false positives — e.g. `Analítica(?!s)`
 * allows the canonical "Analíticas", and `Importar(?! catálogo)` allows the
 * canonical "Importar catálogo" while still catching a bare "Importar" title.
 */

export interface SectionTitleRule {
  /** Section key (matches the nav descriptor). */
  key: string
  /** Path of the section dir, relative to the app repo root. */
  dir: string
  /** Canonical token that must be present (sanity the scan hit the right tree). */
  canonical: string
  /** Old standalone title that must NOT reappear. */
  forbidden: RegExp
}

export const SECTION_TITLE_RULES: SectionTitleRule[] = [
  { key: 'promociones', dir: 'app/(shell)/shop/manage/promotions', canonical: 'Cupones', forbidden: /\bPromociones\b/ },
  { key: 'analitica', dir: 'app/(shell)/shop/manage/analytics', canonical: 'Analíticas', forbidden: /Analítica(?!s)/ },
  { key: 'ajustes', dir: 'app/(shell)/shop/manage/settings', canonical: 'Configuración', forbidden: /\bAjustes\b/ },
  { key: 'importar', dir: 'app/(shell)/shop/manage/import', canonical: 'Importar catálogo', forbidden: /Importar(?! catálogo)/ },
]

/** Every occurrence of an old standalone title in `source` (empty = clean). */
export function findStaleTitle(source: string, forbidden: RegExp): string[] {
  const flags = forbidden.flags.includes('g') ? forbidden.flags : forbidden.flags + 'g'
  const re = new RegExp(forbidden.source, flags)
  return Array.from(source.matchAll(re), (m) => m[0])
}
