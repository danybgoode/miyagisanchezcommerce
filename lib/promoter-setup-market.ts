import { normalizeMarketCode, type MarketCode } from './markets'

export const MAX_PROMOTER_SHOP_DESCRIPTION_LENGTH = 2_000

/**
 * Read the optional operating-market field at the promoter setup boundary.
 *
 * Omitting the field deliberately preserves the established Mexican default in
 * the Medusa internal seller seam. Supplying a value is a different promise:
 * it must be a supported market, never an invitation to silently fall back to
 * Mexico (which would price and publish a US merchant in the wrong market).
 */
export function readPromoterSetupMarket(value: unknown): MarketCode | null | 'invalid' {
  if (value === undefined) return null
  return normalizeMarketCode(value) ?? 'invalid'
}

/** Validate the storefront description before it is handed to Medusa. */
export function readPromoterSetupDescription(value: unknown):
  | { ok: true; value: string | null }
  | { ok: false } {
  if (value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const description = value.trim()
  if (description.length > MAX_PROMOTER_SHOP_DESCRIPTION_LENGTH) return { ok: false }
  return { ok: true, value: description || null }
}
