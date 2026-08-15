/**
 * Shared, framework-free pagination state and slicing for admin lists.
 * Keeping this outside React lets API specs exercise the same list behaviour
 * as client-admin surfaces.
 */

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

/** A changed filter or sort always returns an admin list to its first page. */
export function pageAfterAdminListChange(previousPage: number, changed: boolean): number {
  return changed ? 1 : previousPage
}
