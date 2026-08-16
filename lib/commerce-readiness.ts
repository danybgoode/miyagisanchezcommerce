import { requireMarket, type MarketCode } from './markets'

export type CommerceReadinessReason =
  | 'ready'
  | 'checkout_not_available'
  | 'missing_positive_price'
  | 'currency_mismatch'
  | 'seller_payment_unavailable'

export type CommerceReadiness =
  | { readonly ready: true; readonly market_code: MarketCode; readonly reason: 'ready' }
  | { readonly ready: false; readonly market_code: MarketCode; readonly reason: Exclude<CommerceReadinessReason, 'ready'> }

/**
 * Permanent capability result, not a rollout flag. S4 can make the US rail a
 * real member only when its direct-charge checkout is implemented and verified;
 * until then every web/agent caller receives the same named refusal.
 */
const DIRECT_CHECKOUT_MARKETS: readonly MarketCode[] = ['mx', 'us']

export function resolveCommerceReadiness(input: {
  market: unknown
  priceCents: number | null | undefined
  currency: string | null | undefined
  sellerPaymentAvailable: boolean
}): CommerceReadiness {
  const market = requireMarket(input.market)
  if (!input.priceCents || input.priceCents <= 0) {
    return { ready: false, market_code: market.code, reason: 'missing_positive_price' }
  }
  if (input.currency?.trim().toLowerCase() !== market.currency_code) {
    return { ready: false, market_code: market.code, reason: 'currency_mismatch' }
  }
  if (!DIRECT_CHECKOUT_MARKETS.includes(market.code)) {
    return { ready: false, market_code: market.code, reason: 'checkout_not_available' }
  }
  if (!input.sellerPaymentAvailable) {
    return { ready: false, market_code: market.code, reason: 'seller_payment_unavailable' }
  }
  return { ready: true, market_code: market.code, reason: 'ready' }
}
