/**
 * Catalog status deriver — pure, next-free (catalog-management epic, Sprint 1 ·
 * Story 1.3). Turns a listing's Medusa-native status + stock into the four
 * first-class filter states a seller sees: activo / borrador / pausado / agotado.
 *
 * `status` here is the value `toListingShape` (apps/backend) already computes —
 * 'active' | 'draft' | 'paused' | any other raw Medusa status (proposed/rejected).
 * 'paused' depends on the backend's `metadata.paused` fix (S1.3): without it this
 * would be indistinguishable from 'draft', which is exactly the gap that fix closes.
 */

export type CatalogStatus = 'activo' | 'borrador' | 'pausado' | 'agotado'

export interface CatalogStatusInput {
  status: string
  /** Whether the variant tracks finite stock (physical products). */
  manage_inventory?: boolean | null
  /** False only when a managed item has sold out. */
  in_stock?: boolean | null
}

/**
 * `agotado` takes precedence over `activo` for a published, stock-managed
 * listing that's sold out — it's still "live" in Medusa terms, but a seller
 * needs to see it as a distinct, actionable state (S2's inventory-mode story).
 */
export function deriveCatalogStatus(listing: CatalogStatusInput): CatalogStatus {
  if (listing.status === 'paused') return 'pausado'
  if (listing.status === 'active') {
    if (listing.manage_inventory && listing.in_stock === false) return 'agotado'
    return 'activo'
  }
  // 'draft' and any other raw Medusa status (proposed/rejected) read as borrador.
  return 'borrador'
}

export const CATALOG_STATUS_FILTERS: { value: CatalogStatus; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'agotado', label: 'Agotado' },
  { value: 'borrador', label: 'Borrador' },
  { value: 'pausado', label: 'Pausado' },
]

export function countByCatalogStatus(listings: CatalogStatusInput[]): Record<CatalogStatus, number> {
  const counts: Record<CatalogStatus, number> = { activo: 0, borrador: 0, pausado: 0, agotado: 0 }
  for (const listing of listings) counts[deriveCatalogStatus(listing)]++
  return counts
}
