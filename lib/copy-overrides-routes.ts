/**
 * lib/copy-overrides-routes.ts
 *
 * Pure `namespace`(`.section`) → real page/route lookup (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1) — lets the `/admin/contenido`
 * editor tell Daniel exactly where an edit will show up, instead of a bare
 * `namespace.key` dot-path. Kept free of `next/*`/React so it's both
 * client-importable (a plain lookup table, no server dependency) and
 * Playwright-loadable.
 *
 * Verified against the real route files (`grep`, not guessed) — see the
 * epic's Sprint 2 doc. Every `locales/es.json` top-level namespace is covered;
 * `sellerAcquisition` fans out per-section because each section genuinely
 * powers a distinct `/vende/*` page (`app/(shell)/vende/_components/page-config.ts`).
 * A namespace/section with NO single page (site-wide config, or copy shared
 * across many pages) maps to `null` — the caller shows an explicit label for
 * that, never a fabricated path.
 */

export interface RouteInfo {
  /** Short human label, es-MX. */
  label: string
  /** The real path/slug, or a short parenthetical when there's no single URL. */
  path: string
}

const SELLER_ACQUISITION_SECTIONS: Record<string, RouteInfo | null> = {
  anchor: { label: 'Vende (portada)', path: '/vende' },
  creadores: { label: 'Vende — Creadores', path: '/vende/creadores' },
  negocios: { label: 'Vende — Negocios', path: '/vende/negocios' },
  servicios: { label: 'Vende — Servicios', path: '/vende/servicios' },
  autos: { label: 'Vende — Autos', path: '/vende/autos' },
  migracion: { label: 'Vende — Migración (hub)', path: '/vende/migracion' },
  migracionShopify: { label: 'Vende — Migración Shopify', path: '/vende/migracion/shopify' },
  migracionTiendanube: { label: 'Vende — Migración Tiendanube', path: '/vende/migracion/tiendanube' },
  migracionWoocommerce: { label: 'Vende — Migración WooCommerce', path: '/vende/migracion/woocommerce' },
  migracionBigcartel: { label: 'Vende — Migración BigCartel', path: '/vende/migracion/bigcartel' },
  promotor: { label: 'Vende — Promotor', path: '/vende/promotor' },
  // Shared copy (trust lines, FAQ, self-check aside, …) rendered across every
  // /vende/* page above — deliberately no single URL.
  shared: null,
}

/** A namespace with one single page (no per-section fan-out). */
const SIMPLE_NAMESPACE_ROUTES: Record<string, RouteInfo | null> = {
  home: { label: 'Inicio', path: '/' },
  terms: { label: 'Términos', path: '/terminos' },
  acerca: { label: 'Acerca (plataforma)', path: '/acerca' },
  sweepstakes: { label: 'Sorteos', path: '/g/[slug]' },
  events: { label: 'Eventos', path: '/e/[slug]' },
  // Site-wide mechanics rendered in the shell on every page — no single URL.
  platformTheme: null,
  pwaSearch: null,
}

/** No-single-page fallback label shown when `routeFor*` resolves to `null` for a KNOWN namespace. */
export const NO_SINGLE_PAGE_LABEL = 'config., sin página propia'

/** Friendly namespace label for a filter dropdown (top-level, not per-section). */
export function namespaceLabel(namespace: string): string {
  if (namespace === 'sellerAcquisition') return 'Vende (todas las páginas)'
  return SIMPLE_NAMESPACE_ROUTES[namespace]?.label ?? namespace
}

/**
 * Resolve the route for a namespace + its first key-segment ("section" — the
 * same split `r.key.split('.')[0]` the editor already groups rows by).
 * Returns `null` when the namespace/section is known but has no single page
 * (shared cross-page copy, or site-wide config) — never fabricates a path for
 * an unrecognized namespace either (also `null`, indistinguishable from the
 * "no single page" case; both render the same fallback label to the admin).
 */
export function routeForNamespaceSection(namespace: string, section: string): RouteInfo | null {
  if (namespace === 'sellerAcquisition') return SELLER_ACQUISITION_SECTIONS[section] ?? null
  return SIMPLE_NAMESPACE_ROUTES[namespace] ?? null
}

/** Convenience wrapper — derives the section from a full dot-path `key` the same way the editor groups by. */
export function routeForKey(namespace: string, key: string): RouteInfo | null {
  const section = key.split('.')[0] ?? key
  return routeForNamespaceSection(namespace, section)
}
