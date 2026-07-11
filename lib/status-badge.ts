/**
 * StatusBadge token mapping — seller-portal-rails-foundation S1 · Story 1.1 (R1).
 * Pure + next-free so it's unit-testable with no auth/network, mirroring the
 * `ml-order-badge.ts` convention. Encodes the ONE order-lifecycle→token mapping
 * so every status chip in the portal speaks the same 5 semantic colors
 * (+ a 6th `promo` token reserved for the ML-source override, azafrán — not a
 * 6th "status color", the source badge is a separate signal from the status).
 */

export type StatusToken = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'promo'

const ORDER_STATUS_TOKEN: Record<string, StatusToken> = {
  pending_payment: 'warning',
  paid: 'success',
  processing: 'info',
  shipped: 'info',
  in_transit: 'info',
  delivered: 'success',
  fulfilled: 'success',
  completed: 'neutral',
  refunded: 'danger',
  canceled: 'danger',
  cancelled: 'danger',
}

/** Order lifecycle status → one of the 5 semantic tokens (R1). Unknown statuses read as neutral, never a raw color. */
export function orderStatusToToken(status: string): StatusToken {
  return ORDER_STATUS_TOKEN[status] ?? 'neutral'
}

const OFFER_STATUS_TOKEN: Record<string, StatusToken> = {
  pending: 'warning',
  countered: 'info',
  accepted: 'success',
  declined: 'neutral',
  expired: 'neutral',
  paid: 'success',
}

/** Offer lifecycle status (S2 rails sweep) → one of the 5 semantic tokens. Unknown statuses read as neutral. */
export function offerStatusToToken(status: string): StatusToken {
  return OFFER_STATUS_TOKEN[status] ?? 'neutral'
}

const OFFER_QUALITY_TOKEN: Record<'green' | 'amber' | 'red', StatusToken> = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
}

/** `offerQuality()`'s green/amber/red color (lib/offers.ts) → one of the 5 semantic tokens. */
export function offerQualityToToken(color: 'green' | 'amber' | 'red'): StatusToken {
  return OFFER_QUALITY_TOKEN[color]
}

const RETURN_STATUS_TOKEN: Record<string, StatusToken> = {
  pending: 'warning',
  accepted: 'success',
  partial_refund: 'info',
  declined: 'danger',
  refunded: 'success',
}

/** Return-request status → one of the 5 semantic tokens. Unknown statuses read as neutral. */
export function returnStatusToToken(status: string): StatusToken {
  return RETURN_STATUS_TOKEN[status] ?? 'neutral'
}

const CATALOG_STATUS_TOKEN: Record<string, StatusToken> = {
  activo: 'success',
  pausado: 'warning',
  borrador: 'neutral',
  agotado: 'danger',
  sobre_pedido: 'info',
}

/** Catalog listing status (`deriveCatalogStatus`) → one of the 5 semantic tokens. Unknown statuses read as neutral. */
export function catalogStatusToToken(status: string): StatusToken {
  return CATALOG_STATUS_TOKEN[status] ?? 'neutral'
}
