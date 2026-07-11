/**
 * lib/migration-checkout.ts
 *
 * The `migration` promoter SKU's checkout builder (epic 03 · platform-migrations,
 * Sprint 2 · US-2.1/US-2.2). Unlike custom_domain/subdomain/ml_sync, `migration`
 * is a one-time consulting service with NO ongoing entitlement to gate and NO
 * separate promoter-discount layer — the admin-set flat price (≤150 listings)
 * or the stored quote's total (>150) IS the final number, identical for
 * merchant and promoter (Story 2.1's "same number" guarantee holds trivially).
 *
 * `resolveMigrationCharge` is the ONE place the charge amount is decided —
 * never a client-supplied number (the tamper-proof guarantee: "the API is the
 * guarantee, the UI is courtesy"). Both the Stripe branch (below) and the
 * net-remittance branch (app/api/promoter/close/migration) read the SAME
 * resolver, so they can never disagree about the price.
 *
 * server-only (reaches Supabase + Stripe).
 */
import 'server-only'
import { db } from './supabase'
import { createOneTimeCheckout } from './stripe-subscriptions'
import { PAID_BY_PROMOTER_FLAG } from './promoter-close'
import { getPromoterSkuPrices } from './promoter'
import { getMigrationEstimate } from './migration-estimate-store'
import { decideChargeFromQuote, decideFlatEligibility } from './migration-charge-decision'

export const MIGRATION_CHECKOUT_KIND = 'migration'
export const MIGRATION_CURRENCY = 'MXN'

/** A fixed canonical origin — never trust a (spoofable) request Host. */
export function canonicalOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
}

export type ResolveMigrationChargeResult =
  | { ok: true; amountCents: number; quoteId: string | null }
  | { ok: false; status: number; error: string }

/**
 * Resolve the ONLY authoritative charge amount for a migration close, by
 * fetching the inputs the pure decisions in lib/migration-charge-decision.ts
 * need and deferring to them — this function owns no pricing LOGIC itself,
 * only the DB reads.
 *
 *   - `quoteId` given → `decideChargeFromQuote` (charge EXACTLY the stored
 *     quote's total; a tamper attempt — a spoofed amount elsewhere in the
 *     request — has nothing to act on, since this never reads a
 *     client-supplied amount at all).
 *   - No `quoteId` → `decideFlatEligibility` against the shop's most recent
 *     Shopify connector batch (if any), then the admin-set flat SKU price.
 */
export async function resolveMigrationCharge(input: {
  shopId: string
  quoteId?: string | null
}): Promise<ResolveMigrationChargeResult> {
  if (input.quoteId) {
    const quote = await getMigrationEstimate(input.quoteId)
    const decision = decideChargeFromQuote(quote, input.shopId)
    if (!decision.ok) return decision
    return { ok: true, amountCents: decision.amountCents, quoteId: quote!.id }
  }

  const { data: batch } = await db
    .from('supply_batches')
    .select('id')
    .eq('source_platform', 'shopify')
    .contains('acquisition_settings', { connected_shop_id: input.shopId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let listingCount: number | null = null
  if (batch) {
    const { count } = await db
      .from('supply_items')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
    listingCount = count ?? 0
  }
  const eligibility = decideFlatEligibility(listingCount)
  if (!eligibility.ok) return eligibility

  const prices = await getPromoterSkuPrices()
  const flatMxn = prices.migration
  if (flatMxn == null) {
    return { ok: false, status: 422, error: 'El precio de migración aún no está configurado.' }
  }
  return { ok: true, amountCents: Math.round(flatMxn * 100), quoteId: null }
}

export type StartMigrationCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string }

/** Build a Stripe one-time checkout for the resolved charge amount. */
export async function startMigrationCheckout(input: {
  shopId: string
  sellerClerkId: string
  quoteId?: string | null
  buyerEmail?: string
  promoterId?: string
  paidByPromoter?: boolean
}): Promise<StartMigrationCheckoutResult> {
  const charge = await resolveMigrationCharge({ shopId: input.shopId, quoteId: input.quoteId })
  if (!charge.ok) return charge

  const origin = canonicalOrigin()
  const url = await createOneTimeCheckout({
    amountCents: charge.amountCents,
    currency: MIGRATION_CURRENCY,
    productName: 'Migración de tienda (consultor)',
    successUrl: `${origin}/shop/manage?migration=activated`,
    cancelUrl: `${origin}/shop/manage?migration=cancelled`,
    buyerEmail: input.buyerEmail,
    metadata: {
      kind: MIGRATION_CHECKOUT_KIND,
      shop_id: input.shopId,
      seller_clerk_id: input.sellerClerkId,
      ...(charge.quoteId ? { quote_id: charge.quoteId } : {}),
      ...(input.promoterId ? { promoter_id: input.promoterId, promoter_sku: MIGRATION_CHECKOUT_KIND } : {}),
      ...(input.paidByPromoter ? { paid_by_promoter: PAID_BY_PROMOTER_FLAG } : {}),
    },
  })
  return { ok: true, url }
}
