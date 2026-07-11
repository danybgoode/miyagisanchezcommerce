/**
 * lib/flags-admin-view.ts
 *
 * Pure display-ordering helpers for `/admin/flags` (feature-flags-inhouse epic,
 * admin-flags-cleanup chore). Kept free of `next/*`/React so the Playwright
 * `api` project can unit-test the sort/filter/pagination math with zero DOM.
 *
 * The list has grown past 25 flags across many epics with no consistent
 * ordering (insertion order = whenever each flag happened to be added) — sort
 * alphabetically by key by default so a flag is always where you'd guess to
 * look, allow re-sorting by status/polarity/recency, filter by free-text
 * search + status + polarity, and paginate so the table stays scannable as
 * it keeps growing. Mirrors `lib/catalog-query.ts`'s pure-builder shape (an
 * allow-listed `URLSearchParams` build for shareable/bookmarkable filters) —
 * same convention, no new pattern.
 */

export type FlagSort = 'key_asc' | 'key_desc' | 'status' | 'polarity' | 'recent'

export type FlagStatusFilter = 'all' | 'on' | 'off'
export type FlagPolarityFilter = 'all' | 'killswitch' | 'enablement'

interface SortableFlag {
  key: string
  enabled: boolean
  polarity: string
  updated_at: string | null
}

interface SearchableFlag {
  key: string
  description: string | null
}

/** Alphabetical by key, ascending — stable, deterministic, no locale surprises. */
export function sortFlagsByKey<T extends { key: string }>(flags: readonly T[]): T[] {
  return [...flags].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

const byKeyAsc = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/**
 * Dispatch to the chosen sort. Every branch other than `key_asc`/`key_desc`
 * tie-breaks alphabetically by key, so the order is always fully
 * deterministic (never "whatever the array happened to be in").
 */
export function sortFlags<T extends SortableFlag>(flags: readonly T[], sort: FlagSort): T[] {
  const list = [...flags]
  switch (sort) {
    case 'key_desc':
      return list.sort((a, b) => -byKeyAsc(a, b))
    case 'status':
      // Enabled first (what's live right now is usually what you came to check).
      return list.sort((a, b) => (a.enabled === b.enabled ? byKeyAsc(a, b) : a.enabled ? -1 : 1))
    case 'polarity':
      // Kill-switch (default ON, deliberate act = disabling) before enablement.
      return list.sort((a, b) =>
        a.polarity === b.polarity ? byKeyAsc(a, b) : a.polarity === 'killswitch' ? -1 : 1,
      )
    case 'recent':
      // Most recently changed first; never-changed (no row yet) rows sort last.
      return list.sort((a, b) => {
        if (a.updated_at === b.updated_at) return byKeyAsc(a, b)
        if (a.updated_at == null) return 1
        if (b.updated_at == null) return -1
        return a.updated_at > b.updated_at ? -1 : 1
      })
    case 'key_asc':
    default:
      return list.sort(byKeyAsc)
  }
}

/** Case-insensitive substring match against the flag's key OR its description. */
export function filterFlagsByQuery<T extends SearchableFlag>(flags: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...flags]
  return flags.filter(
    (f) => f.key.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q),
  )
}

export function filterFlagsByStatus<T extends { enabled: boolean }>(
  flags: readonly T[],
  status: FlagStatusFilter,
): T[] {
  if (status === 'all') return [...flags]
  return flags.filter((f) => (status === 'on' ? f.enabled : !f.enabled))
}

export function filterFlagsByPolarity<T extends { polarity: string }>(
  flags: readonly T[],
  polarity: FlagPolarityFilter,
): T[] {
  if (polarity === 'all') return [...flags]
  return flags.filter((f) => f.polarity === polarity)
}

export interface PageResult<T> {
  pageItems: T[]
  totalPages: number
  /** The page actually served — clamped into [1, totalPages], never out of range. */
  page: number
}

/** Slice `items` into page `page` of `pageSize`. Clamps an out-of-range page instead of returning empty. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const clampedPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (clampedPage - 1) * pageSize
  return { pageItems: items.slice(start, start + pageSize), totalPages, page: clampedPage }
}

export interface FlagsSearchParams {
  q?: string
  status?: string // all | on | off
  polarity?: string // all | killswitch | enablement
  sort?: string // FlagSort
  page?: string
}

const ALLOWED_KEYS = ['q', 'status', 'polarity', 'sort'] as const

/** Query string for an `/admin/flags` page `Link` (keeps `page`, mirrors `buildCatalogPageUrl`). */
export function buildFlagsPageUrl(params: FlagsSearchParams, page: number): string {
  const sp = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const val = params[key]
    if (val != null && val !== '' && val !== 'all') sp.set(key, val)
  }
  if (page > 1) sp.set('page', String(page))
  return sp.toString() ? `/admin/flags?${sp.toString()}` : '/admin/flags'
}
