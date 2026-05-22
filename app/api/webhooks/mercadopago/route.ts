/**
 * MercadoPago IPN webhook — handles payment.created / payment.updated notifications.
 *
 * MP sends two notification formats:
 *   v2: POST body  { type: "payment", data: { id: "123" }, action: "payment.created" }
 *   v1: GET/POST   ?topic=payment&id=123   (also supported as fallback)
 *
 * We always return 200 quickly, then do async work — MP retries on non-200.
 * Idempotency is enforced by the UNIQUE INDEX on marketplace_orders.mp_payment_id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getMpPayment } from '@/lib/mercadopago'
import { sendSaleCompletedToSeller, sendOrderConfirmedToBuyer, cancelScheduledEmail, getSellerEmail } from '@/lib/email'
import { formatOfferAmount } from '@/lib/offers'
import { deliverOrderWebhook } from '@/lib/ucp/webhooks'
import { tg } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  // ── Parse notification ────────────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    body = await req.json() as Record<string, unknown>
  } catch { /* MP sometimes sends form-encoded; fall through */ }

  // Support both v2 body and v1 query-param formats
  const { searchParams } = new URL(req.url)
  const topic = (body.type ?? body.topic ?? searchParams.get('topic')) as string | undefined
  const dataId = (body.data as Record<string, unknown> | undefined)?.id
  const paymentId = String(dataId ?? body.id ?? searchParams.get('id') ?? '')

  // Acknowledge non-payment topics immediately (merchant_order, etc.)
  if (topic !== 'payment' || !paymentId || paymentId === 'undefined') {
    return NextResponse.json({ received: true })
  }

  // ── Fetch & verify payment from MP ───────────────────────────────────────
  let payment
  try {
    payment = await getMpPayment(paymentId)
  } catch (err) {
    console.error('[mp webhook] failed to fetch payment:', paymentId, err)
    // Return 200 so MP doesn't endlessly retry a bad ID
    return NextResponse.json({ received: true })
  }

  // Only process approved payments
  if (payment.status !== 'approved') {
    return NextResponse.json({ received: true })
  }

  // ── Parse external_reference ──────────────────────────────────────────────
  let ref: Record<string, string> = {}
  try {
    ref = JSON.parse(payment.external_reference ?? '{}') as Record<string, string>
  } catch { /* ignore */ }

  const { listing_id, shop_id, listing_type, offer_id } = ref
  if (!listing_id || !shop_id) {
    console.warn('[mp webhook] missing listing/shop in external_reference for payment:', paymentId)
    return NextResponse.json({ received: true })
  }

  const amountCents = Math.round((payment.transaction_amount ?? 0) * 100)
  const currency    = (payment.currency_id ?? 'MXN').toUpperCase()
  const buyerEmail  = payment.payer?.email ?? null
  const buyerName   = [payment.payer?.first_name, payment.payer?.last_name]
    .filter(Boolean).join(' ').trim() || null

  // ── Idempotency — skip if already recorded ────────────────────────────────
  const { data: existing } = await db
    .from('marketplace_orders')
    .select('id')
    .eq('mp_payment_id', paymentId)
    .maybeSingle()

  if (existing) return NextResponse.json({ received: true })

  // ── Record order ──────────────────────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .insert({
      listing_id,
      shop_id,
      mp_preference_id: (payment as unknown as Record<string, unknown>).preference_id as string ?? null,
      mp_payment_id:    paymentId,
      mp_status:        payment.status,
      buyer_email:      buyerEmail,
      buyer_name:       buyerName,
      amount_cents:     amountCents,
      currency,
      status:           'paid',
      metadata:         offer_id ? { offer_id } : {},
    })
    .select('id')
    .single()

  if (!order) {
    console.error('[mp webhook] order insert failed for payment:', paymentId)
    return NextResponse.json({ received: true })
  }

  // ── Fire UCP webhook (non-fatal) ─────────────────────────────────────────
  deliverOrderWebhook(order.id, 'order.created').catch(e => console.error('[ucp-webhook] mp:', e))

  // ── Mark winning offer as paid + cancel payment-expiry reminder ───────────
  if (offer_id) {
    const { data: paidOffer } = await db
      .from('marketplace_offers')
      .select('scheduled_reminder_ids')
      .eq('id', offer_id)
      .single()

    await db.from('marketplace_offers').update({ status: 'paid' }).eq('id', offer_id)

    const paidReminders = (paidOffer?.scheduled_reminder_ids ?? {}) as Record<string, string>
    if (paidReminders.buyer_payment_expiry) {
      cancelScheduledEmail(paidReminders.buyer_payment_expiry).catch(() => {})
    }
  }

  // ── Auto-decline competing offers for this listing ────────────────────────
  await db.from('marketplace_offers')
    .update({ status: 'declined' })
    .eq('listing_id', listing_id)
    .in('status', ['pending', 'countered', 'accepted'])
    .neq('id', offer_id ?? '')

  // ── Fetch listing + shop context for emails ───────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, currency, marketplace_shops!inner(name, clerk_user_id)')
    .eq('id', listing_id)
    .single()

  if (listing) {
    // ── Telegram admin alert ────────────────────────────────────────────────
    const amtFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amountCents / 100)
    tg.salePaid(amtFmt, listing.title, buyerEmail ?? 'comprador', 'mercadopago')

    const shop = listing.marketplace_shops as unknown as { name: string; clerk_user_id: string | null }
    const listingUrl    = `https://miyagisanchez.com/l/${listing_id}`
    const amountFormatted = formatOfferAmount(amountCents, currency)
    const isDigital     = listing_type === 'digital'

    if (buyerEmail) {
      sendOrderConfirmedToBuyer({
        buyerEmail, buyerName,
        listingTitle: listing.title, listingUrl,
        amountPaid: amountFormatted, shopName: shop.name, isDigital,
      }).catch(e => console.error('[mp email] buyer:', e))
    }

    if (shop.clerk_user_id) {
      getSellerEmail(shop.clerk_user_id)
        .then(sellerEmail => {
          if (sellerEmail) {
            return sendSaleCompletedToSeller({
              sellerEmail, listingTitle: listing.title, listingUrl,
              amountPaid: amountFormatted, buyerName, buyerEmail, isDigital,
            })
          }
        })
        .catch(e => console.error('[mp email] seller:', e))
    }
  }

  return NextResponse.json({ received: true })
}

// MP sometimes sends IPN as GET with query params — acknowledge those too
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const topic     = searchParams.get('topic')
  const paymentId = searchParams.get('id')

  if (topic === 'payment' && paymentId) {
    // Re-route to POST handler logic via internal fetch (simpler: just return 200
    // and let the actual POST notification do the work — MP sends both)
    console.log('[mp webhook] GET IPN received for payment:', paymentId)
  }

  return NextResponse.json({ received: true })
}
