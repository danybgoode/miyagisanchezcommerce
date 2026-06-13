/**
 * PDP image gallery — pure index math (no React, no next/cache), so the
 * Playwright `api` runner can unit-test it for free. The Gallery client island
 * (`app/l/[id]/Gallery.tsx`) and its fullscreen lightbox both read from here, so
 * wrap/clamp behaviour can't drift between the two surfaces.
 */

/** Wrap an index into [0, count) so prev-from-first → last and next-from-last → first. */
export function wrapIndex(i: number, count: number): number {
  if (count <= 0) return 0
  return ((i % count) + count) % count
}

/**
 * Active slide from a scroll-snap track: round(scrollLeft / slideWidth), clamped
 * into [0, count). Returns 0 for degenerate inputs (zero-width / empty track).
 */
export function indexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (slideWidth <= 0 || count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / slideWidth)))
}
