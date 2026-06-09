/**
 * Coordinated-delivery fallback — the pure, next-free seam for Sprint 3 (S3.2).
 *
 * When Envía can't quote a shipping address (a carrier error or a timeout, or no
 * coverage), the buyer must not dead-end. We offer a selectable "Entrega acordada"
 * (coordinated) fallback that lets checkout proceed with manual payment.
 *
 * The backend (start-checkout) rejects card + coordinated delivery — coordinated
 * delivery requires "pago directo" (SPEI / efectivo). So when the fallback is
 * active, payment is steered to a manual method (see pickManualPaymentId).
 *
 * Kept free of any `next/*` import so the Playwright `api` runner can unit-test it.
 */

export interface QuoteOutcome {
  /** A quote request is in flight. */
  loading: boolean
  /** A hard failure (carrier error, timeout, backend unreachable), or null. */
  error: string | null
  /** Number of usable carrier rates returned. */
  ratesCount: number
  /** A "no coverage" message from the backend (rates came back empty), or null. */
  message: string | null
}

/**
 * Offer the coordinated fallback once quoting has SETTLED with no usable rate:
 * either it errored, or it returned zero rates with a coverage message. Never
 * while still loading, and never when usable rates exist.
 */
export function shouldOfferCoordinatedFallback(o: QuoteOutcome): boolean {
  if (o.loading) return false
  if (o.error) return true
  return o.ratesCount === 0 && !!o.message
}

/**
 * The first manual ("pago directo") payment method's id, or null if the seller
 * offers no manual method (in which case coordinated checkout can't complete
 * online and the buyer is pointed at the seller).
 */
export function pickManualPaymentId<Id extends string>(
  methods: readonly { id: Id; kind: 'online' | 'manual' }[],
): Id | null {
  return methods.find(m => m.kind === 'manual')?.id ?? null
}
