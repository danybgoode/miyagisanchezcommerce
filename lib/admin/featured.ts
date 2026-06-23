/**
 * Homepage Selección · Sprint 2 — pure validation seam for the admin "feature a
 * product" write. Kept next-free so a pure-logic `api` spec
 * (`e2e/admin-featured.spec.ts`) proves the shape without auth/network. The
 * `withAdmin` route (`app/api/admin/seleccion/[id]/route.ts`) calls this, then
 * forwards `{ featured, featured_rank }` to the backend internal route which
 * writes `metadata.featured` + `metadata.featured_rank` on the Medusa product.
 */

export interface FeaturedPatch {
  featured: boolean
  /** asc order among pins; null = unpinned (or pinned without an explicit rank). */
  featured_rank: number | null
}

export type FeaturedPatchResult = FeaturedPatch | { error: string }

/** Narrows an unknown parsed body to a valid `{ featured, featured_rank }`, or an error. */
export function buildFeaturedPatch(input: unknown): FeaturedPatchResult {
  if (input == null || typeof input !== 'object') return { error: 'Body must be an object' }
  const body = input as Record<string, unknown>

  if (typeof body.featured !== 'boolean') return { error: 'featured (boolean) required' }

  // Unpinning always clears the rank — a stale rank on an unpinned product is
  // dead weight (curation gates on `featured === true` first).
  if (body.featured === false) return { featured: false, featured_rank: null }

  // Pinned: rank is optional (absent/null ⇒ unranked → falls back to fresh order).
  if (body.featured_rank == null) return { featured: true, featured_rank: null }
  const n = Number(body.featured_rank)
  if (!Number.isFinite(n) || n < 0) return { error: 'featured_rank must be a number ≥ 0 or null' }
  return { featured: true, featured_rank: Math.floor(n) }
}
