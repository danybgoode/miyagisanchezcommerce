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

/**
 * Buyer-facing copy for a refusal.
 *
 * MARKET-SHAPED, because the refusals are not all US-only. `COORD_REQUIRES_MANUAL_PAYMENT`
 * fires on a Mexican coordinated-delivery checkout too, and the first version answered
 * it in English — hardcoded English on an es-MX surface, which is the one copy rule
 * this codebase states as unbreakable (AGENTS.md rule 5). Found by the Codex
 * cross-family pass on PR #359.
 *
 * These live here rather than in `locales/{es,en}.json` deliberately: they are thrown
 * as `Error` messages from a pure module that the dictionary loader cannot reach, and
 * the dictionary is for rendered chrome. The es-MX string is what an MX buyer sees,
 * which is what the rule protects.
 */
export type MarketCheckoutRefusalCode = Exclude<MarketCheckoutAdmission, { ok: true }>['code']

const REFUSALS: Record<MarketCode, Record<MarketCheckoutRefusalCode, string>> = {
  mx: {
    US_ONLINE_PAYMENT_REQUIRED: 'Los pedidos de Estados Unidos se pagan con tarjeta.',
    US_CARRIER_UNAVAILABLE: 'El envío con paquetería cotizada no está disponible en el marketplace de Estados Unidos.',
    US_ADDRESS_REQUIRED: 'Se requiere una dirección de entrega completa.',
    US_CLIENT_SHIPPING_FORBIDDEN: 'El costo de envío no se puede definir desde el navegador.',
    COORD_REQUIRES_MANUAL_PAYMENT: 'La entrega acordada se paga directamente con el vendedor, no en línea.',
  },
  us: {
    US_ONLINE_PAYMENT_REQUIRED: "US orders are paid by card, into the seller's own Stripe account.",
    US_CARRIER_UNAVAILABLE: "Carrier-rated shipping is not available in the US marketplace. Choose the seller's own shipping instead.",
    US_ADDRESS_REQUIRED: 'A complete US delivery address is required.',
    US_CLIENT_SHIPPING_FORBIDDEN: "Shipping cost can't be set by the browser on a US order.",
    COORD_REQUIRES_MANUAL_PAYMENT: 'Coordinated delivery is arranged directly with the seller, not paid online.',
  },
}

export function marketCheckoutRefusalMessage(
  code: MarketCheckoutRefusalCode,
  market: MarketCode = 'mx',
): string {
  return REFUSALS[market][code]
}
