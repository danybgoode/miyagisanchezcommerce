/**
 * Catalog status deriver — pure, next-free (catalog-management epic, Sprint 1 ·
 * Story 1.3, extended Sprint 2 · Story 2.1). Turns a listing's Medusa-native
 * status + stock/backorder flags into the five first-class filter states a
 * seller sees: activo / borrador / pausado / agotado / sobre_pedido.
 *
 * `status` here is the value `toListingShape` (apps/backend) already computes —
 * 'active' | 'draft' | 'paused' | any other raw Medusa status (proposed/rejected).
 * 'paused' depends on the backend's `metadata.paused` fix (S1.3): without it this
 * would be indistinguishable from 'draft', which is exactly the gap that fix closes.
 */

export type CatalogStatus = 'activo' | 'borrador' | 'pausado' | 'agotado' | 'sobre_pedido'

export interface CatalogStatusInput {
  status: string
  /** Whether the variant tracks finite stock (physical products). */
  manage_inventory?: boolean | null
  /** False only when a managed item has sold out. */
  in_stock?: boolean | null
  /** Native Medusa "sobre pedido" flag (catalog-management S2 · Story 2.1). */
  allow_backorder?: boolean | null
}

/**
 * `sobre_pedido` takes precedence over `agotado` (checked first) for a
 * published, backorder-enabled listing — regardless of current stock level.
 * That's the entire point of the story: qty 0 stops meaning "vanished" for a
 * backorder item, it reads as "sobre pedido," never "agotado."
 *
 * `agotado` still takes precedence over `activo` for a published, stock-
 * managed (non-backorder) listing that's sold out — it's still "live" in
 * Medusa terms, but a seller needs to see it as a distinct, actionable state.
 */
export function deriveCatalogStatus(listing: CatalogStatusInput): CatalogStatus {
  if (listing.status === 'paused') return 'pausado'
  if (listing.status === 'active') {
    if (listing.manage_inventory && listing.allow_backorder) return 'sobre_pedido'
    if (listing.manage_inventory && listing.in_stock === false) return 'agotado'
    return 'activo'
  }
  // 'draft' and any other raw Medusa status (proposed/rejected) read as borrador.
  return 'borrador'
}

export const CATALOG_STATUS_FILTERS: { value: CatalogStatus; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'agotado', label: 'Agotado' },
  { value: 'sobre_pedido', label: 'Sobre pedido' },
  { value: 'borrador', label: 'Borrador' },
  { value: 'pausado', label: 'Pausado' },
]

export function countByCatalogStatus(listings: CatalogStatusInput[]): Record<CatalogStatus, number> {
  const counts: Record<CatalogStatus, number> = {
    activo: 0, borrador: 0, pausado: 0, agotado: 0, sobre_pedido: 0,
  }
  for (const listing of listings) counts[deriveCatalogStatus(listing)]++
  return counts
}
