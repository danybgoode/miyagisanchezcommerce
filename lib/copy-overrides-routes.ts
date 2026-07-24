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
 * `sellerAcquisition`, `sweepstakes`, and `events` each fan out per-section
 * because their sections genuinely render on DIFFERENT surfaces (Sprint 4 —
 * confirmed `sweepstakes.seller`/`events.seller` are the seller-portal
 * management pages and `sweepstakes.email`/`events.email` are transactional
 * emails, not the same public page every OTHER section of those namespaces
 * once incorrectly resolved to).
 *
 * A `RouteInfo` whose `path` isn't a real URL (a parenthetical like
 * `(correo transaccional, no es una página web)`) is a deliberate, KNOWN
 * no-single-page case — still a real, non-null `RouteInfo` so the caller can
 * render it exactly like any other destination. `null` is reserved for a
 * namespace/section this map does NOT recognize at all (a real drift signal —
 * e.g. a new key added to `locales/*.json` without updating this map) —
 * the caller shows `NO_SINGLE_PAGE_LABEL` only for that case now, never for
 * an intentional no-page namespace.
 */

export interface RouteInfo {
  /** Short human label, es-MX. */
  label: string
  /** The real path/slug, or a parenthetical description when there's no single URL. */
  path: string
}

const SELLER_ACQUISITION_SECTIONS: Record<string, RouteInfo | null> = {
  anchor: { label: 'Vende (portada)', path: '/vende' },
  // Rendered as part of the /vende portada (`buildAnchorPageConfig` reads
  // `copy.aiChannel` directly, `app/(shell)/vende/_components/page-config.ts`)
  // — same page as `anchor`, not a separate one.
  aiChannel: { label: 'Vende (portada)', path: '/vende' },
  creadores: { label: 'Vende — Creadores', path: '/vende/creadores' },
  negocios: { label: 'Vende — Negocios', path: '/vende/negocios' },
  fundadoras: { label: 'Vende — Fundadoras', path: '/vende/fundadoras' },
  servicios: { label: 'Vende — Servicios', path: '/vende/servicios' },
  autos: { label: 'Vende — Autos', path: '/vende/autos' },
  mundial: { label: 'Vende — Mundial', path: '/vende/mundial' },
  migracion: { label: 'Vende — Migración (hub)', path: '/vende/migracion' },
  migracionShopify: { label: 'Vende — Migración Shopify', path: '/vende/migracion/shopify' },
  migracionTiendanube: { label: 'Vende — Migración Tiendanube', path: '/vende/migracion/tiendanube' },
  migracionWoocommerce: { label: 'Vende — Migración WooCommerce', path: '/vende/migracion/woocommerce' },
  migracionBigcartel: { label: 'Vende — Migración BigCartel', path: '/vende/migracion/bigcartel' },
  promotor: { label: 'Vende — Promotor', path: '/vende/promotor' },
  promotorMigracion: { label: 'Vende — Promotor Migración', path: '/vende/promotor/migracion' },
  // Shared copy (trust lines, FAQ, self-check aside, …) rendered across every
  // /vende/* page above — a KNOWN no-single-page case, not "unrecognized".
  shared: { label: 'Vende — compartido', path: '(aparece en cada página /vende/*)' },
}

/**
 * `sweepstakes`/`events` each fan into 3 sections that render on 3 DIFFERENT
 * surfaces (Sprint 4 fix — confirmed against the real `getDictionary()` call
 * sites, not guessed): the public participant flow, the seller-portal
 * management page, and transactional email templates. Before this fix all 3
 * incorrectly resolved to the public route alone.
 */
const SWEEPSTAKES_SECTIONS: Record<string, RouteInfo | null> = {
  public: { label: 'Sorteos — público', path: '/g/[slug]' },
  seller: { label: 'Sorteos — panel de tienda', path: '/shop/manage/sweepstakes' },
  email: { label: 'Sorteos — correos', path: '(correo transaccional, no es una página web)' },
}

/**
 * `events.seller` genuinely spans TWO seller-portal routes (the list/create
 * page and the `/[id]` roster/attendance page both read this same dictionary
 * section, confirmed at `app/(shell)/shop/manage/eventos/page.tsx:50` and
 * `app/(shell)/shop/manage/eventos/[id]/page.tsx:49`) — the list page is
 * named as the primary destination.
 */
const EVENTS_SECTIONS: Record<string, RouteInfo | null> = {
  public: { label: 'Eventos — público', path: '/e/[slug]' },
  seller: { label: 'Eventos — panel de tienda', path: '/shop/manage/eventos' },
  email: { label: 'Eventos — correos', path: '(correo transaccional, no es una página web)' },
}

/** A namespace with one single page (no per-section fan-out). */
const SIMPLE_NAMESPACE_ROUTES: Record<string, RouteInfo | null> = {
  home: { label: 'Inicio', path: '/' },
  terms: { label: 'Términos', path: '/terminos' },
  acerca: { label: 'Acerca (plataforma)', path: '/acerca' },
  // Site-wide mechanics rendered in the shell on every page — a KNOWN
  // no-single-page case (site config), not "unrecognized".
  platformTheme: { label: 'Tema de la plataforma', path: '(config. de toda la plataforma)' },
  pwaSearch: { label: 'Búsqueda (app)', path: '(config. de toda la plataforma)' },
}

/**
 * Fallback label shown ONLY when `routeFor*` resolves to `null` — a
 * namespace/section this map does not recognize at all (Sprint 4: every
 * KNOWN no-single-page case now gets its own descriptive `RouteInfo` instead
 * of `null`, so reaching this fallback is itself a signal this map is
 * missing a real, new namespace/section — not a normal, expected state).
 */
export const NO_SINGLE_PAGE_LABEL = 'sección no reconocida — revisar lib/copy-overrides-routes.ts'

/** Friendly namespace label for a filter dropdown (top-level, not per-section). */
export function namespaceLabel(namespace: string): string {
  if (namespace === 'sellerAcquisition') return 'Vende (todas las páginas)'
  if (namespace === 'sweepstakes') return 'Sorteos'
  if (namespace === 'events') return 'Eventos'
  return SIMPLE_NAMESPACE_ROUTES[namespace]?.label ?? namespace
}

/**
 * Resolve the route for a namespace + its first key-segment ("section" — the
 * same split `r.key.split('.')[0]` the editor already groups rows by).
 * Returns `null` ONLY for a namespace/section this map doesn't recognize at
 * all — every known case (including every "no single page" one) gets a real
 * `RouteInfo` now (Sprint 4).
 */
export function routeForNamespaceSection(namespace: string, section: string): RouteInfo | null {
  if (namespace === 'sellerAcquisition') return SELLER_ACQUISITION_SECTIONS[section] ?? null
  if (namespace === 'sweepstakes') return SWEEPSTAKES_SECTIONS[section] ?? null
  if (namespace === 'events') return EVENTS_SECTIONS[section] ?? null
  return SIMPLE_NAMESPACE_ROUTES[namespace] ?? null
}

/** Convenience wrapper — derives the section from a full dot-path `key` the same way the editor groups by. */
export function routeForKey(namespace: string, key: string): RouteInfo | null {
  const section = key.split('.')[0] ?? key
  return routeForNamespaceSection(namespace, section)
}
