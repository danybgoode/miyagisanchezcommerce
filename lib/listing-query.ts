import type { SearchParams } from './types'

/**
 * Listing search-query helpers — kept free of any `next/*` import so the
 * Playwright `api` runner can unit-test the pure logic (the cached/DB wrappers
 * in `lib/listings.ts` import `next/cache`, which the runner can't load).
 *
 * Single source of truth for the listing-type taxonomy, shared by the search
 * query builder, the type chip rail, and the result-card badge.
 */

// The five listing types the marketplace recognises (Medusa product type /
// metadata; already normalized onto every listing in lib/listings.ts).
export type ListingTypeValue = 'product' | 'service' | 'rental' | 'digital' | 'subscription'

// Chip rail — es-MX plural labels. "product" leads as the default/majority type.
export const LISTING_TYPE_FILTERS: { value: ListingTypeValue; label: string }[] = [
  { value: 'product', label: 'Productos' },
  { value: 'service', label: 'Servicios' },
  { value: 'rental', label: 'Rentas' },
  { value: 'digital', label: 'Digitales' },
  { value: 'subscription', label: 'Suscripciones' },
]

// Card affordance — es-MX singular, non-product only (products are the default,
// so they get no noisy badge). Unknown/`product` → null.
const BADGE_LABELS: Record<string, string> = {
  service: 'Servicio',
  rental: 'Renta',
  digital: 'Digital',
  subscription: 'Suscripción',
}

export function listingTypeBadge(type: string | null | undefined): string | null {
  return type ? (BADGE_LABELS[type] ?? null) : null
}

// Mobile filter sheet — the apply button's live label (es-MX, singular/plural).
// `null` (count not yet loaded) → a neutral "Ver resultados"; 0 → "Sin resultados".
export function resultCountLabel(count: number | null | undefined): string {
  if (count == null) return 'Ver resultados'
  if (count <= 0) return 'Sin resultados'
  return `Ver ${count} ${count === 1 ? 'resultado' : 'resultados'}`
}

// Build query string from SearchParams, forwarding all supported filter keys.
export function buildQuery(params: SearchParams & { limit?: number | string }): string {
  const allowed = [
    'q', 'category', 'state', 'municipio', 'condition', 'min_price', 'max_price',
    'location', 'sort', 'page', 'limit', 'listing_type',
    'brand', 'year_from', 'year_to', 'km_from', 'km_to', 'transmission', 'fuel',
    'rooms_min', 'rooms_max', 'surface_min', 'surface_max', 'property_type',
  ]
  const sp = new URLSearchParams()
  for (const key of allowed) {
    const val = (params as Record<string, string | number | undefined>)[key]
    if (val != null && val !== '') sp.set(key, String(val))
  }
  return sp.toString() ? `?${sp.toString()}` : ''
}
