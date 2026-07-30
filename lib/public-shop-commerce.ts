/**
 * Payment availability from the privacy-safe PUBLIC seller projection.
 *
 * Catalog/shop surfaces need only "can the buyer choose this rail?". Credentials
 * and transfer coordinates stay behind checkout and seller-authenticated seams.
 * Keeping this parser next-free lets every public renderer and agent schema share
 * the exact same boolean contract.
 */

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export interface PublicStripeProjection {
  readonly connected?: boolean
  readonly enabled?: boolean
  readonly charges_enabled?: boolean
  readonly details_submitted?: boolean
  readonly onboarding_complete?: boolean
}

export interface PublicTransferProjection {
  readonly enabled?: boolean
  readonly configured?: boolean
}

export interface PublicMercadoPagoProjection {
  readonly connected?: boolean
  readonly enabled?: boolean
  readonly live_mode?: boolean
}

export interface PublicShopMetadata {
  readonly mp_enabled?: boolean
  readonly settings?: {
    readonly stripe?: PublicStripeProjection
    readonly mercadopago?: PublicMercadoPagoProjection
    readonly checkout?: {
      readonly bank_transfer?: PublicTransferProjection
      readonly dimo?: PublicTransferProjection
      readonly [key: string]: unknown
    }
    readonly [key: string]: unknown
  }
  readonly [key: string]: unknown
}

export interface PublicShopPaymentAvailability {
  readonly stripe: boolean
  readonly mercadopago: boolean
  readonly bankTransfer: boolean
  readonly dimo: boolean
}

export function publicShopPaymentAvailability(
  metadata: PublicShopMetadata | Record<string, unknown> | null | undefined,
): PublicShopPaymentAvailability {
  const meta = objectValue(metadata)
  const settings = objectValue(meta.settings)
  const stripe = objectValue(settings.stripe)
  const mercadoPago = objectValue(settings.mercadopago)
  const checkout = objectValue(settings.checkout)
  const bankTransfer = objectValue(checkout.bank_transfer)
  const dimo = objectValue(checkout.dimo)

  return Object.freeze({
    stripe:
      stripe.connected === true &&
      stripe.charges_enabled === true &&
      stripe.enabled !== false,
    mercadopago:
      meta.mp_enabled !== false &&
      mercadoPago.connected === true &&
      mercadoPago.enabled !== false,
    bankTransfer:
      bankTransfer.configured === true &&
      bankTransfer.enabled !== false,
    dimo:
      dimo.configured === true &&
      dimo.enabled === true,
  })
}
