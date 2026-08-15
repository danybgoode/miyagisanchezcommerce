/**
 * lib/copy-overrides-admin-view.ts
 *
 * Pure search/filter/sort/pagination for `/admin/contenido` (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1) — same shape as
 * `lib/flags-admin-view.ts` (admin-flags-cleanup chore): URL-search-param-
 * driven, so filters are shareable/bookmarkable and survive a refresh, and the
 * client bundle stays limited to just the editor's save/restore/preview
 * interactivity. Kept free of `next/*`/React so the Playwright `api` project
 * can unit-test the math with zero DOM. The ~119-key list only grows, so
 * pagination here follows the same established convention rather than a new one.
 */

import { sectionForKey } from './copy-overrides-sections'

export type ContenidoSort = 'namespace_asc' | 'recent'
export type ContenidoStatusFilter = 'all' | 'overridden' | 'default'

interface SearchableKey {
  namespace: string
  key: string
  defaultEs: string
  defaultEn: string | null
}

interface StatusableKey {
  overrideEs: string | null
  overrideEn: string | null
}

interface SortableKey {
  namespace: string
  key: string
  updatedAt: string | null
}

const byNamespaceKeyAsc = (a: { namespace: string; key: string }, b: { namespace: string; key: string }) => {
  if (a.namespace !== b.namespace) return a.namespace < b.namespace ? -1 : 1
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** Case-insensitive substring match against namespace, key, or either locale's default value. */
export function filterKeysByQuery<T extends SearchableKey>(keys: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...keys]
  return keys.filter(
    (k) =>
      k.namespace.toLowerCase().includes(q) ||
      k.key.toLowerCase().includes(q) ||
      k.defaultEs.toLowerCase().includes(q) ||
      (k.defaultEn ?? '').toLowerCase().includes(q),
  )
}

/** `''` or `'all'` means every namespace. */
export function filterKeysByNamespace<T extends { namespace: string }>(keys: readonly T[], namespace: string): T[] {
  if (!namespace || namespace === 'all') return [...keys]
  return keys.filter((k) => k.namespace === namespace)
}

/**
 * `''` or `'all'` means every section. A key's "section" comes from
 * `sectionForKey` (`lib/copy-overrides-sections.ts`) — the SAME call the
 * page-first nav makes, which is the point: this used to inline
 * `key.split('.')[0]` and the nav inlined it separately, so the two could
 * drift apart and open a nav group onto an empty field list.
 *
 * `T` carries `namespace` as well as `key` because the rule is
 * namespace-dependent (`sellerCopy`'s hashed keys section by source page).
 */
export function filterKeysBySection<T extends { namespace: string; key: string }>(
  keys: readonly T[],
  section: string,
): T[] {
  if (!section || section === 'all') return [...keys]
  return keys.filter((k) => sectionForKey(k.namespace, k.key) === section)
}

export function filterKeysByStatus<T extends StatusableKey>(keys: readonly T[], status: ContenidoStatusFilter): T[] {
  if (status === 'all') return [...keys]
  return keys.filter((k) => {
    const hasOverride = k.overrideEs !== null || k.overrideEn !== null
    return status === 'overridden' ? hasOverride : !hasOverride
  })
}

/** Every branch tie-breaks by namespace+key, so the order is always fully deterministic. */
export function sortKeys<T extends SortableKey>(keys: readonly T[], sort: ContenidoSort): T[] {
  const list = [...keys]
  if (sort === 'recent') {
    return list.sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return byNamespaceKeyAsc(a, b)
      if (a.updatedAt == null) return 1
      if (b.updatedAt == null) return -1
      return a.updatedAt > b.updatedAt ? -1 : 1
    })
  }
  return list.sort(byNamespaceKeyAsc)
}

// Kept as a compatibility export for `/admin/contenido` and its existing specs.
export { paginate, type PageResult } from './admin-pagination'

export interface ContenidoSearchParams {
  q?: string
  namespace?: string
  section?: string
  status?: string // ContenidoStatusFilter
  sort?: string // ContenidoSort
  page?: string
}

/**
 * Next.js's real `searchParams` value for a repeated query key (`?q=a&q=b`) is
 * a `string[]`, not a `string` — always take the first value rather than
 * passing the array straight into a string-only operation (e.g. `.trim()`),
 * which would throw. Called once at the page boundary, before anything reads
 * `ContenidoSearchParams`'s fields as plain strings.
 */
export function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const ALLOWED_KEYS = ['q', 'namespace', 'section', 'status', 'sort'] as const

/** Query string for an `/admin/contenido` page `Link` (keeps `page`, mirrors `buildFlagsPageUrl`). */
export function buildContenidoPageUrl(params: ContenidoSearchParams, page: number): string {
  const sp = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const val = params[key]
    if (val != null && val !== '' && val !== 'all') sp.set(key, val)
  }
  if (page > 1) sp.set('page', String(page))
  return sp.toString() ? `/admin/contenido?${sp.toString()}` : '/admin/contenido'
}
