/**
 * GET /api/cron/reconcile-checkouts
 *
 * Safety net for the checkout flow. Catches carts that were paid at the
 * provider but never completed into a Medusa order (buyer closed the redirect
 * tab AND the provider webhook missed/misfired).
 *
 * Flow:
 *   1. Ask the Medusa backend to scan for incomplete-but-paid carts. The backend
 *      re-checks Stripe/MP as the source of truth and patches the payment
 *      session so authorizePayment will pass.
 *   2. For each ready cart, call the built-in /store/carts/:id/complete (the same
 *      idempotent path the webhooks use) → creates the Medusa order.
 *   3. Backfill the Supabase order mirror via upsertOrderMirror (idempotent).
 *   4. Telegram alert so Daniel knows a reconciliation happened (these are
 *      exceptions worth eyeballing).
 *
 * Called by Vercel Cron (see vercel.json). Protected by CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { upsertOrderMirror } from '@/lib/order-mirror'
import { markListingPurchased } from '@/lib/offer-state'
import { deliverOrderWebhook } from '@/lib/ucp/webhooks'
import { tg } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

type ReadyCart = {
  cart_id: string
  provider: 'stripe' | 'mercadopago'
  product_id: string
  seller_id: string
  amount_cents: number
  currency: string
  buyer_email: string | null
  buyer_name: string | null
  fulfillment_method: string | null
  pickup_spot_id: string | null
  shipping_amount_cents: number
  shipping_quote: {
    rate_id: string
    carrier: string | null
    service: string | null
    amount_cents: number
    currency: string
    delivery_estimate: number | null
    delivery_label: string | null
  } | null
  offer_id: string | null
  stripe_session_id: string | null
  mp_payment_id: string | null
}

/** Complete a Medusa cart → creates the order. Returns the order ID (idempotent). */
async function completeMedusaCart(cartId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': MEDUSA_PUB_KEY },
      cache: 'no-store',
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      console.error('[reconcile] complete failed:', cartId, b)
      return null
    }
    const data = await res.json().catch(() => ({}))
    return data?.order?.id ?? null
  } catch (e) {
    console.error('[reconcile] complete error:', cartId, e)
    return null
  }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 1. Ask the backend for paid-but-incomplete carts ──────────────────────
  let ready: ReadyCart[] = []
  try {
    const scanRes = await fetch(`${MEDUSA_BASE}/store/carts/scan-incomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ older_than_minutes: 10, max_age_hours: 24 }),
      cache: 'no-store',
    })
    if (!scanRes.ok) {
      const b = await scanRes.json().catch(() => ({}))
      console.error('[reconcile] scan-incomplete failed:', b)
      return NextResponse.json({ error: 'scan failed', detail: b }, { status: 502 })
    }
    const data = await scanRes.json()
    ready = (data?.ready ?? []) as ReadyCart[]
  } catch (e) {
    console.error('[reconcile] scan-incomplete error:', e)
    return NextResponse.json({ error: 'scan error' }, { status: 502 })
  }

  if (ready.length === 0) {
    return NextResponse.json({ reconciled: 0, message: 'No incomplete-paid carts.' })
  }

  // ── 2-3. Complete each cart + backfill the mirror ─────────────────────────
  const reconciled: Array<{ cartId: string; orderId: string; created: boolean; provider: string }> = []

  for (const c of ready) {
    const orderId = await completeMedusaCart(c.cart_id)
    if (!orderId) continue

    const { created } = await upsertOrderMirror({
      medusaOrderId: orderId,
      cartId: c.cart_id,
      sellerId: c.seller_id,
      productId: c.product_id,
      paymentMethod: c.provider,
      amountCents: c.amount_cents,
      currency: c.currency,
      buyerEmail: c.buyer_email,
      buyerName: c.buyer_name,
      fulfillmentMethod: c.fulfillment_method,
      pickupSpotId: c.pickup_spot_id,
      shippingAmountCents: c.shipping_amount_cents,
      shippingQuote: c.shipping_quote,
      offerId: c.offer_id,
      stripeSessionId: c.stripe_session_id,
      mpPaymentId: c.mp_payment_id,
    })

    // Only run one-time side effects when this run actually created the mirror
    // (i.e. a genuinely-missed order, not a late webhook we raced).
    if (created) {
      if (c.product_id) {
        markListingPurchased({ listingId: c.product_id, offerId: c.offer_id ?? undefined })
          .catch(e => console.error('[reconcile] markListingPurchased:', e))
      }
      deliverOrderWebhook(orderId, 'order.created').catch(e => console.error('[reconcile] ucp webhook:', e))
    }

    reconciled.push({ cartId: c.cart_id, orderId, created, provider: c.provider })
  }

  const newlyCreated = reconciled.filter(r => r.created)
  if (newlyCreated.length > 0) {
    const lines = newlyCreated.map(r => `• ${r.provider} — order ${r.orderId} (cart ${r.cartId})`).join('\n')
    tg.alert(`🔧 Reconciliados ${newlyCreated.length} pedido(s) pagados sin completar:\n${lines}`).catch(() => {})
  }

  return NextResponse.json({
    reconciled: reconciled.length,
    newly_created: newlyCreated.length,
    orders: reconciled,
  })
}
