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

/**
 * Where a changed filter or sort puts you: back at the top.
 *
 * A constant, not a function. It began as `pageAfterAdminListChange(previous,
 * changed)` — but every call site passed `changed: true`, which makes it a
 * function with one reachable branch, and a spec over it asserted only that
 * `true` returns 1. That is the shape the review notes warn about: a test that
 * proves the wrapper was called and nothing about what the wrapper is for.
 *
 * The property that actually matters is asserted in
 * `e2e/admin-list-pagination.spec.ts` against `paginate` itself — a user whose
 * filter shrinks the result set must never land on an empty page, which holds
 * BOTH because the callers reset to this and, independently, because `paginate`
 * clamps. Two mechanisms, deliberately, since a missed reset at one call site
 * should degrade to "shows the last page" rather than "shows nothing".
 */
export const ADMIN_LIST_FIRST_PAGE = 1
