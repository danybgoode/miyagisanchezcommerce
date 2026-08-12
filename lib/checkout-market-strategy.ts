import { requireMarket, type MarketCode } from './markets'

export type MarketCheckoutProvider = 'stripe' | 'mercadopago' | 'spei' | 'cash' | 'manual'
export type MarketCheckoutFulfillment =
  | 'local_pickup'
  | 'shipping'
  | 'digital'
  | 'service'
  | 'rental'
  | 'coord'
  | 'manual_carrier'
  | 'none'

export interface MarketCheckoutAddress {
  line1?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
}

export type MarketCheckoutAdmission =
  | { ok: true; market: MarketCode; shippingAmountCents: 0 | null }
  | {
      ok: false
      market: MarketCode
      code:
        | 'US_ONLINE_PAYMENT_REQUIRED'
        | 'US_CARRIER_UNAVAILABLE'
        | 'US_ADDRESS_REQUIRED'
        | 'US_CLIENT_SHIPPING_FORBIDDEN'
        | 'COORD_REQUIRES_MANUAL_PAYMENT'
    }

/**
 * Permanent money-path rules that must run before the first cart/customer write.
 * This is deliberately independent of React, Next and Medusa so web/UCP/MCP can
 * prove the same admission matrix without touching a payment provider.
 */
export function admitMarketCheckout(input: {
  market: unknown
  provider: MarketCheckoutProvider
  fulfillmentMethod?: MarketCheckoutFulfillment
  shippingAddress?: MarketCheckoutAddress | null
  hasClientShippingQuote?: boolean
}): MarketCheckoutAdmission {
  const market = requireMarket(input.market)
  const fulfillment = input.fulfillmentMethod ?? 'none'

  if (fulfillment === 'coord' && !['manual', 'spei', 'cash'].includes(input.provider)) {
    return { ok: false, market: market.code, code: 'COORD_REQUIRES_MANUAL_PAYMENT' }
  }

  if (market.code !== 'us') {
    return { ok: true, market: market.code, shippingAmountCents: null }
  }

  // There is no US carrier. Envía and Correos are Mexican and S6 is stopped at its
  // evidence gate, so `shipping` would promise a rate that nothing can produce.
  if (fulfillment === 'shipping') {
    return { ok: false, market: 'us', code: 'US_CARRIER_UNAVAILABLE' }
  }
  // Any client-supplied shipping money on a US order is a number the caller invented:
  // the US has no rate seam at all.
  if (input.hasClientShippingQuote) {
    return { ok: false, market: 'us', code: 'US_CLIENT_SHIPPING_FORBIDDEN' }
  }

  // Only ADDRESSED deliveries need an address. An earlier draft of this required
  // `manual_carrier` for every US checkout, which would have refused a US digital
  // good, service, rental and local pickup — all of which the market supports.
  if (ADDRESSED_FULFILLMENT.has(fulfillment)) {
    const address = input.shippingAddress
    if (
      address?.country?.trim().toUpperCase() !== 'US'
      || !address?.line1?.trim()
      || !address.city?.trim()
      || !address.state?.trim()
      || !address.postal_code?.trim()
    ) {
      return { ok: false, market: 'us', code: 'US_ADDRESS_REQUIRED' }
    }
  }

  // `coord` is manual-pay and was already decided above. Everything else in the US
  // settles on the one rail that can take USD.
  if (fulfillment !== 'coord' && input.provider !== 'stripe') {
    return { ok: false, market: 'us', code: 'US_ONLINE_PAYMENT_REQUIRED' }
  }

  // US delivery is seller-funded. The backend stays authoritative; stating it here
  // keeps every presentation at $0 rather than leaving the total to guess.
  return { ok: true, market: 'us', shippingAmountCents: ADDRESSED_FULFILLMENT.has(fulfillment) ? 0 : null }
}

/** Fulfillment methods that put a parcel in front of a buyer's door. */
const ADDRESSED_FULFILLMENT = new Set<MarketCheckoutFulfillment>(['shipping', 'manual_carrier'])

export function marketCheckoutRefusalMessage(code: Exclude<MarketCheckoutAdmission, { ok: true }>['code']): string {
  switch (code) {
    case 'US_ONLINE_PAYMENT_REQUIRED':
      return 'US orders are paid by card, into the seller\'s own Stripe account.'
    case 'US_CARRIER_UNAVAILABLE':
      return "Carrier-rated shipping is not available in the US marketplace. Choose the seller's own shipping instead."
    case 'US_ADDRESS_REQUIRED':
      return 'A complete US delivery address is required.'
    case 'US_CLIENT_SHIPPING_FORBIDDEN':
      return "Shipping cost can't be set by the browser on a US order."
    case 'COORD_REQUIRES_MANUAL_PAYMENT':
      return 'Coordinated delivery is arranged directly with the seller, not paid online.'
  }
}
