import { normalizeMarketCode, type MarketCode } from './markets'

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
