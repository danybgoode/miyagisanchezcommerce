import { selectTenants, type TenantFilter, type TenantRow, type TenantSortKey, type SortDirection } from './tenant-directory'
import type { MarketCode } from '@/lib/markets'

export type ClaimLinkScope = 'unclaimed' | 'ready' | 'all'

/** The public shop route 404s for held merchant previews and unreadable privacy state. */
export function claimLinkPreviewUrl(
  market: MarketCode | null,
  slug: string,
  available: boolean | null | undefined,
  origin = '',
): string | null {
  if (available !== true || !market || !slug) return null
  return `${origin}/${market}/s/${encodeURIComponent(slug)}`
}

export function claimLinkRegistrationEmail(row: TenantRow): string {
  if (row.publicSellerClaimed === false) return 'Sin reclamar'
  if (row.publicSellerClaimed === true && row.registrationEmail && row.registrationEmail !== 'unavailable') {
    return row.registrationEmail
  }
  return 'No disponible'
}

/** A list hint only. The POST rechecks the canonical seller before signing a link. */
export function claimLinkAvailability(row: TenantRow): { ready: true } | { ready: false; reason: string } {
  if (!row.medusaSellerId) return { ready: false, reason: 'Sin importar a Medusa' }
  if (row.publicSellerId && row.publicSellerId !== row.medusaSellerId) {
    return { ready: false, reason: 'Identidad de vendedor inconsistente' }
  }
  if (row.publicSellerClaimed === true) return { ready: false, reason: 'Ya reclamada' }
  if (row.publicSellerClaimed === null) return { ready: false, reason: 'Reclamo no disponible' }
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
