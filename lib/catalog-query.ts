/**
 * Catalog table query helpers — pure, next-free (catalog-management epic,
 * Sprint 1 · Story 1.2). Mirrors the marketplace browse pattern in
 * `lib/listing-query.ts`'s `buildQuery()`: an explicit allow-list copied into a
 * `URLSearchParams`, so filters stay URL-addressable (shareable/bookmarkable)
 * and the builder is unit-testable outside the Playwright browser runner.
 */

export const CATALOG_PAGE_SIZE = 24

export type CatalogSort = 'recent' | 'title' | 'price_asc' | 'price_desc'

export interface CatalogSearchParams {
  q?: string
  status?: string // activo | agotado | borrador | pausado
  category?: string
  channel?: string // miyagi | ml
  stock?: string // in_stock | agotado | unlimited
  sort?: CatalogSort
  page?: string
}

const ALLOWED_KEYS = ['q', 'status', 'category', 'channel', 'stock', 'sort'] as const

/** Query string for the backend Store API call (adds limit/offset, drops `page`). */
export function buildCatalogQuery(
  params: CatalogSearchParams,
  extra: { limit?: number; offset?: number } = {},
): string {
  const sp = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const val = params[key]
    if (val != null && val !== '') sp.set(key, val)
  }
  if (extra.limit != null) sp.set('limit', String(extra.limit))
  if (extra.offset != null) sp.set('offset', String(extra.offset))
  return sp.toString() ? `?${sp.toString()}` : ''
}

/** Query string for a `/shop/manage/catalogo` page Link (keeps `page`, no limit/offset). */
export function buildCatalogPageUrl(params: CatalogSearchParams, page: number): string {
  const sp = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const val = params[key]
    if (val != null && val !== '') sp.set(key, val)
  }
  if (page > 1) sp.set('page', String(page))
  return sp.toString() ? `/shop/manage/catalogo?${sp.toString()}` : '/shop/manage/catalogo'
}
