/**
 * lib/launchpad-shelf.ts
 *
 * Bookshop launchpad — Sprint 2, Story 2.2 ("El estante Convocatoria").
 *
 * Pure, next-free deriver for the launchpad shelf suggestion: given a shop's
 * published launchpad works (each with the seller-collection ids it currently
 * belongs to) and the shop's existing collections, decide whether to SUGGEST
 * gathering the works into a "Convocatoria" collection (OSPP) and which works
 * are still missing from it. Suggestion, never forced — the seller confirms.
 * No JSX / no network / no `next/*` → unit-testable in the `api` gate
 * (`e2e/launchpad-shelf.spec.ts`). The confirm endpoint
 * (`/api/sell/launchpad/shelf`) does the create/assign I/O around THIS.
 */

/** The canonical shelf name. Matching is case-insensitive on this exact word so
 *  a seller who renamed the collection something else gets a fresh suggestion. */
export const CONVOCATORIA_COLLECTION_NAME = 'Convocatoria'

/** A published launchpad work + the seller-collection ids it's already in. */
export interface ShelfWork {
  productId: string
  /** Seller-collection ids this product currently belongs to (platform-taxonomy
   *  categories excluded — the caller filters to owned collections first). */
  collectionIds: string[]
}

/** A seller-owned collection (Medusa category with the seller's handle prefix). */
export interface ShelfCollection {
  id: string
  name: string
  handle: string
}

export interface ShelfSuggestion {
  /** Show the "crea tu estante" card? True only when there are works AND at
   *  least one isn't shelved yet. */
  suggest: boolean
  /** The existing Convocatoria collection, or null (the endpoint creates it). */
  convocatoria: ShelfCollection | null
  /** Works not yet in the Convocatoria collection (all works when it's absent). */
  missingWorkIds: string[]
  /** Total published works (for the card's copy). */
  totalWorks: number
}

function isConvocatoria(name: string): boolean {
  return name.trim().toLowerCase() === CONVOCATORIA_COLLECTION_NAME.toLowerCase()
}

/** Find the shop's Convocatoria collection, if it already exists. */
export function findConvocatoria(collections: ShelfCollection[]): ShelfCollection | null {
  return collections.find((c) => isConvocatoria(c.name)) ?? null
}

/**
 * The suggestion state. `suggest` is true only when there are published works
 * and at least one is not yet in the Convocatoria collection — so the card
 * disappears once everything is shelved (and never shows for a shop with no
 * launchpad works).
 */
export function deriveShelfSuggestion(
  works: ShelfWork[],
  collections: ShelfCollection[],
): ShelfSuggestion {
  const convocatoria = findConvocatoria(collections)
  const missingWorkIds = convocatoria
    ? works.filter((w) => !w.collectionIds.includes(convocatoria.id)).map((w) => w.productId)
    : works.map((w) => w.productId)
  return {
    suggest: works.length > 0 && missingWorkIds.length > 0,
    convocatoria,
    missingWorkIds,
    totalWorks: works.length,
  }
}
