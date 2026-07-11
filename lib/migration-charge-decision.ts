/**
 * lib/migration-charge-decision.ts
 *
 * The PURE decision core behind the `migration` SKU's close-from-quote
 * guarantee (epic 03 · platform-migrations, Sprint 2 · US-2.2): "a close
 * referencing a quote cannot charge a different amount — the API is the
 * guarantee, the UI is courtesy." Split out of lib/migration-checkout.ts
 * (server-only, hits Supabase) so this decision is directly unit-testable
 * (e2e/promoter-close-migration.spec.ts), mirroring lib/promoter-commission.ts's
 * decideAccrual seam.
 *
 * The tamper-proof property is structural, not a runtime check: neither
 * function below takes a client-supplied amount as input AT ALL — there is
 * nothing for a spoofed request field to act on. `decideChargeFromQuote`
 * always returns the STORED quote's total; a caller cannot make it return
 * anything else no matter what it claims elsewhere in the request.
 *
 * No next/*, no server-only, no DB import.
 */

/** Sprint 2's flat-fee cap — kept in sync with lib/migration-parity.ts's
 *  VERY_CUSTOM_LISTING_THRESHOLD (same number, different name here so this
 *  module needs no import from a file that itself has no DB/next deps but
 *  documents a different concern — see that file for the single source). */
export const MIGRATION_FLAT_LISTING_CAP = 150

export interface QuoteForCharge {
  shop_id: string
  total_price_cents: number
}

export type ChargeDecision =
  | { ok: true; amountCents: number }
  | { ok: false; status: number; error: string }

/**
 * Given a quote row (or null, if the id didn't resolve to one) and the
 * requesting shop, decide the charge. No amount parameter exists — the
 * number always comes from `quote.total_price_cents`, never from the caller.
 */
export function decideChargeFromQuote(quote: QuoteForCharge | null, shopId: string): ChargeDecision {
  if (!quote) return { ok: false, status: 404, error: 'Cotización no encontrada.' }
  if (quote.shop_id !== shopId) {
    return { ok: false, status: 403, error: 'La cotización no pertenece a esta tienda.' }
  }
  return { ok: true, amountCents: quote.total_price_cents }
}

export type FlatEligibility = { ok: true } | { ok: false; status: number; error: string }

/**
 * The no-quote path's cap check: given the shop's live connector-batch
 * listing count (or null when it has no staged Shopify batch at all — a
 * manual/off-platform migration, nothing to check), decide whether the flat
 * SKU price may be charged without a quote. Over the cap ⇒ refuse; the
 * promoter must generate/reference a quote instead.
 */
export function decideFlatEligibility(connectedBatchListingCount: number | null): FlatEligibility {
  if (connectedBatchListingCount != null && connectedBatchListingCount > MIGRATION_FLAT_LISTING_CAP) {
    return {
      ok: false,
      status: 422,
      error: 'Este catálogo supera el paquete de precio fijo — genera una cotización primero.',
    }
  }
  return { ok: true }
}
