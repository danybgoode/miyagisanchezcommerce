import { selectTenants, type TenantFilter, type TenantRow, type TenantSortKey, type SortDirection } from './tenant-directory'

export type ClaimLinkScope = 'unclaimed' | 'ready' | 'all'

/** A list hint only. The POST rechecks the canonical seller before signing a link. */
export function claimLinkAvailability(row: TenantRow): { ready: true } | { ready: false; reason: string } {
  if (row.publicSellerClaimed === true) return { ready: false, reason: 'Ya reclamada' }
  if (row.publicSellerClaimed === null) return { ready: false, reason: 'Reclamo no disponible' }
  if (!row.medusaSellerId) return { ready: false, reason: 'Sin importar a Medusa' }
  if (!row.slug) return { ready: false, reason: 'Sin identificador' }
  if (row.status !== 'active') {
    return { ready: false, reason: row.status === 'unavailable' ? 'Estado no disponible' : 'Tienda no activa' }
  }
  if (row.publicSellerVerified !== true) {
    return { ready: false, reason: row.publicSellerVerified === false ? 'Tienda no verificada' : 'Verificación no disponible' }
  }
  if (!row.operatingMarketCode) return { ready: false, reason: 'Mercado no disponible' }
  return { ready: true }
}

export function selectClaimLinkShops(
  rows: readonly TenantRow[],
  scope: ClaimLinkScope,
  filter: TenantFilter,
  sort: { key: TenantSortKey; direction: SortDirection },
): TenantRow[] {
  const selected = selectTenants(rows, filter, sort)
  if (scope === 'all') return selected
  if (scope === 'ready') return selected.filter((row) => claimLinkAvailability(row).ready)
  return selected.filter((row) => row.publicSellerClaimed === false)
}
