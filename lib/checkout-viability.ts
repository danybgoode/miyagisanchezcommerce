/**
 * lib/checkout-viability.ts
 *
 * Pure decision seam for the listing activation "can this actually be
 * checked out?" gate (extracted from `lib/listing-status.ts`'s
 * `checkCheckoutViability`, arranged-only-delivery epic, Sprint 1 · S1.2, so
 * the rule is unit-testable without a Medusa fetch — mirrors the
 * `lib/inventory-mode.ts` deriveInventoryMode pattern).
 *
 * Two paths to viable:
 *  - traditional: hasDelivery (carrier or local pickup) && hasPayment (any
 *    online rail or a manual one).
 *  - arranged (epic S1.2): delivery_mode === 'arranged' && a manual payment
 *    method (SPEI or cash) — no carrier/pickup required, since checkout
 *    strips card/instant rails for a coordinated sale (start-checkout's 422
 *    guard already enforces manual-only).
 * Coexist-permissive (Daniel, 2026-07-11): arranged is an ADDITIONAL valid
 * path, not a replacement — a listing satisfying the traditional check stays
 * viable even if its delivery_mode happens to be 'arranged'.
 */

export interface CheckoutViabilityInput {
  listingType: string
  deliveryMode: 'carrier' | 'arranged' | null | undefined
  hasLiveShipping: boolean
  hasLocalPickup: boolean
  hasStripe: boolean
  hasMp: boolean
  hasSpei: boolean
  hasDimo: boolean
  hasCash: boolean
}

/** Returns `null` when viable, or the es-MX error message to show the seller. */
export function deriveCheckoutViability(input: CheckoutViabilityInput): string | null {
  const { listingType, deliveryMode, hasLiveShipping, hasLocalPickup, hasStripe, hasMp, hasSpei, hasDimo, hasCash } = input

  if (listingType !== 'product') return null

  const hasDelivery = hasLiveShipping || hasLocalPickup
  const hasPayment = hasStripe || hasMp || hasSpei || hasDimo
  const isArranged = deliveryMode === 'arranged'
  const hasManual = hasSpei || hasCash

  if ((isArranged && hasManual) || (hasDelivery && hasPayment)) return null

  if (isArranged) {
    return 'Para activar este anuncio con entrega acordada, configura al menos un método de pago ' +
      'manual (SPEI o recolección con efectivo). Ve a Mi tienda → Configuración → Pagos.'
  }

  const missing: string[] = []
  if (!hasDelivery) missing.push('una forma de entrega (envío a domicilio o recolección en mano)')
  if (!hasPayment) missing.push('un método de pago (MercadoPago, Stripe, SPEI o DiMo)')

  return `Para activar este anuncio configura ${missing.join(' y ')}. ` +
    'Ve a Mi tienda → Configuración → Pagos y Envíos.'
}
