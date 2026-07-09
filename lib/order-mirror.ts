/**
 * Supabase order mirror — shared writer for the Medusa-backed checkout flow.
 *
 * The Medusa order is the system of record. `marketplace_orders` is a read
 * mirror that the seller/buyer order UIs, order-autoconfirm, ship-manual, and
 * returns still query. It is written from three places that must stay in sync:
 *   - /api/webhooks/stripe        (handleMedusaCheckoutComplete)
 *   - /api/webhooks/mercadopago   (handleMedusaMpPayment)
 *   - /api/cron/reconcile-checkouts (safety net for missed webhooks)
 *
 * `upsertOrderMirror` is idempotent on `metadata.medusa_order_id`, so duplicate
 * deliveries (webhook retries, cron re-runs racing a late webhook) never create
 * duplicate rows.
 */

import { db } from '@/lib/supabase'
import { EVENT_TICKETS_METADATA_KEY, type EventTicket } from '@/lib/event-ticket-state'

export interface OrderMirrorShippingQuote {
  rate_id: string
  carrier: string | null
  service: string | null
  amount_cents: number
  currency: string
  delivery_estimate: number | null
  delivery_label: string | null
}

export interface OrderMirrorInput {
  /** Medusa order ID — the idempotency key. */
  medusaOrderId: string
  cartId: string
  /** Medusa seller ID (stored as shop_id for the existing queries). */
  sellerId: string
  /** Medusa product ID (stored as listing_id). */
  productId: string
  paymentMethod: 'stripe' | 'mercadopago'
  amountCents: number
  currency: string
  buyerEmail: string | null
  buyerName: string | null
  /** Buyer's Clerk id (flag-gated, null-safe) — buyer notifications money-path S2. */
  buyerClerkId?: string | null
  fulfillmentMethod?: string | null
  pickupSpotId?: string | null
  shippingAmountCents?: number
  shippingQuote?: OrderMirrorShippingQuote | null
  offerId?: string | null
  stripeSessionId?: string | null
  mpPaymentId?: string | null
  /** Sales channel of the order (e.g. 'custom_domain') for seller attribution. */
  channel?: string | null
  /** Event admission tickets copied from Medusa order metadata for roster reads. */
  eventTickets?: EventTicket[] | null
}

export interface OrderMirrorResult {
  created: boolean
  id: string | null
}

/**
 * Insert the Supabase mirror row for a completed Medusa order, unless one
 * already exists for this Medusa order ID. Never throws — returns
 * `{ created: false, id: null }` on conflict/error so callers can continue.
 */
export async function upsertOrderMirror(input: OrderMirrorInput): Promise<OrderMirrorResult> {
  // ── Idempotency — keyed on the Medusa order ID ─────────────────────────────
  const { data: existing } = await db
    .from('marketplace_orders')
    .select('id')
    .eq('metadata->>medusa_order_id', input.medusaOrderId)
    .maybeSingle()

  if (existing) return { created: false, id: existing.id }

  const row = {
    shop_id: input.sellerId || '',
    listing_id: input.productId || '',
    ...(input.stripeSessionId ? { stripe_session_id: input.stripeSessionId } : {}),
    ...(input.mpPaymentId ? { mp_payment_id: input.mpPaymentId } : {}),
    buyer_email: input.buyerEmail,
    buyer_name: input.buyerName,
    buyer_clerk_user_id: input.buyerClerkId ?? null,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: 'paid',
    shipping_method: input.fulfillmentMethod ?? 'pending',
    shipping_cost_cents: input.shippingAmountCents ?? 0,
    metadata: {
      medusa_order_id: input.medusaOrderId,
      medusa_cart_id: input.cartId,
      payment_method: input.paymentMethod,
      fulfillment_method: input.fulfillmentMethod ?? null,
      pickup_spot_id: input.pickupSpotId ?? null,
      shipping_quote: input.shippingQuote ?? null,
      ...(input.offerId ? { offer_id: input.offerId } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.eventTickets?.length ? { [EVENT_TICKETS_METADATA_KEY]: input.eventTickets } : {}),
    },
  }

  const { data, error } = await db
    .from('marketplace_orders')
    .insert(row)
    .select('id')
    .single()

  if (error || !data) {
    // Likely a unique-index conflict from a racing writer — treat as "already there".
    console.error('[order-mirror] insert failed (treated as existing):', input.medusaOrderId, error)
    return { created: false, id: null }
  }

  return { created: true, id: data.id }
}
