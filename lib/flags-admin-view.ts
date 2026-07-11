/**
 * lib/flags-admin-view.ts
 *
 * Pure display-ordering helpers for `/admin/flags` (feature-flags-inhouse epic,
 * admin-flags-cleanup chore). Kept free of `next/*`/React so the Playwright
 * `api` project can unit-test the sort/pagination math with zero DOM.
 *
 * The list has grown past 25 flags across many epics with no consistent
 * ordering (insertion order = whenever each flag happened to be added) — sort
 * alphabetically by key so a flag is always where you'd guess to look, and
 * paginate so the table stays scannable as it keeps growing.
 */

/** Alphabetical by key, ascending — stable, deterministic, no locale surprises. */
export function sortFlagsByKey<T extends { key: string }>(flags: readonly T[]): T[] {
  return [...flags].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
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
