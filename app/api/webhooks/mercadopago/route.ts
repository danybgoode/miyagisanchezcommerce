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
import { getMpPayment, getMpPreapproval } from '@/lib/mercadopago'
import { sendSaleCompletedToSeller, sendOrderConfirmedToBuyer, getSellerEmail } from '@/lib/email'
import { formatOfferAmount } from '@/lib/offers'
import { markListingPurchased } from '@/lib/offer-state'
import { deliverOrderWebhook } from '@/lib/ucp/webhooks'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/** Patch the MP payment session with the real payment ID, then complete the Medusa cart. Returns order ID. */
async function completeMedusaCartWithMp(cartId: string, mpPaymentId: string): Promise<string | null> {
  try {
    // Step 1: authorize the session with the real MP payment ID
    const authRes = await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/mp-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
      body: JSON.stringify({ mp_payment_id: mpPaymentId }),
    })
    if (!authRes.ok) {
      const body = await authRes.json().catch(() => ({}))
      console.error('[mp webhook] mp-authorize failed:', cartId, body)
      return null
    }

    // Step 2: complete the cart (authorizePayment will see status: approved now)
    const completeRes = await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
    })
    if (!completeRes.ok) {
      const body = await completeRes.json().catch(() => ({}))
      console.error('[mp webhook] cart complete failed:', cartId, body)
      return null
    }
    const data = await completeRes.json().catch(() => ({}))
    const orderId = data?.order?.id ?? null
    console.log('[mp webhook] Medusa cart completed:', cartId, '→ order:', orderId)
    return orderId
  } catch (e) {
    console.error('[mp webhook] completeMedusaCartWithMp error:', cartId, e)
    return null
  }
}

/** Fetch listing info from Medusa for email context */
async function getMedusaListing(productId: string): Promise<{ title: string; seller_name: string; seller_clerk_id?: string } | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${productId}`, {
      headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY },
    })
    if (!res.ok) return null
    const { listing } = await res.json()
    return {
      title: listing?.title ?? listing?.name ?? 'Producto',
      seller_name: listing?.seller?.name ?? listing?.shop?.name ?? '',
      seller_clerk_id: listing?.seller?.clerk_user_id ?? listing?.shop?.clerk_user_id ?? undefined,
    }
  } catch {
    return null
  }
}

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
  const resourceId = String(dataId ?? body.id ?? searchParams.get('id') ?? '')

  // ── Route preapproval (subscription) notifications ────────────────────────
  if (topic === 'preapproval' && resourceId && resourceId !== 'undefined') {
    await handleMpPreapproval(resourceId).catch(e =>
      console.error('[mp webhook] preapproval handler error:', e),
    )
    return NextResponse.json({ received: true })
  }

  const paymentId = resourceId

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

  const amountCents = Math.round((payment.transaction_amount ?? 0) * 100)
  const currency    = (payment.currency_id ?? 'MXN').toUpperCase()
  const buyerEmail  = payment.payer?.email ?? null
  const buyerName   = [payment.payer?.first_name, payment.payer?.last_name]
    .filter(Boolean).join(' ').trim() || null

  // ── New Medusa-backed flow (cart_id in payment.metadata) ─────────────────
  const mpMeta = (payment.metadata ?? {}) as Record<string, string>
  if (mpMeta.cart_id) {
    await handleMedusaMpPayment({
      paymentId,
      cartId: mpMeta.cart_id,
      productId: mpMeta.product_id ?? '',
      sellerId: mpMeta.seller_id ?? '',
      offerId: mpMeta.offer_id,
      fulfillmentMethod: mpMeta.fulfillment_method,
      pickupSpotId: mpMeta.pickup_spot_id,
      shippingRateId: mpMeta.shipping_rate_id,
      shippingCarrier: mpMeta.shipping_carrier,
      shippingService: mpMeta.shipping_service,
      shippingAmountCents: Number(mpMeta.shipping_amount_cents ?? 0) || 0,
      shippingCurrency: mpMeta.shipping_currency,
      shippingDeliveryEstimate: mpMeta.shipping_delivery_estimate,
      shippingDeliveryLabel: mpMeta.shipping_delivery_label,
      amountCents,
      currency,
      buyerEmail,
      buyerName,
    })
    return NextResponse.json({ received: true })
  }

  // ── Legacy Supabase flow (external_reference has JSON) ───────────────────
  let ref: Record<string, string> = {}
  try {
    ref = JSON.parse(payment.external_reference ?? '{}') as Record<string, string>
  } catch { /* ignore */ }

  const { listing_id, shop_id, listing_type, offer_id } = ref
  if (!listing_id || !shop_id) {
    console.warn('[mp webhook] missing listing/shop in external_reference for payment:', paymentId)
    return NextResponse.json({ received: true })
  }

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

  // ── Mark winning offer paid, decline competing offers, close mirror listing
  await markListingPurchased({ listingId: listing_id, offerId: offer_id })

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

// ── New Medusa flow MP payment handler ────────────────────────────────────────

async function handleMedusaMpPayment({
  paymentId,
  cartId,
  productId,
  sellerId,
  offerId,
  fulfillmentMethod,
  pickupSpotId,
  shippingRateId,
  shippingCarrier,
  shippingService,
  shippingAmountCents,
  shippingCurrency,
  shippingDeliveryEstimate,
  shippingDeliveryLabel,
  amountCents,
  currency,
  buyerEmail,
  buyerName,
}: {
  paymentId: string
  cartId: string
  productId: string
  sellerId: string
  offerId?: string
  fulfillmentMethod?: string
  pickupSpotId?: string
  shippingRateId?: string
  shippingCarrier?: string
  shippingService?: string
  shippingAmountCents?: number
  shippingCurrency?: string
  shippingDeliveryEstimate?: string
  shippingDeliveryLabel?: string
  amountCents: number
  currency: string
  buyerEmail: string | null
  buyerName: string | null
}) {
  // 1. Complete the Medusa cart (mp-authorize + complete)
  const medusaOrderId = await completeMedusaCartWithMp(cartId, paymentId)

  // 2. Record in Supabase so the existing order UIs can find it
  if (medusaOrderId) {
    const { error: insertErr } = await db.from('marketplace_orders').insert({
      shop_id: sellerId ?? '',
      listing_id: productId ?? '',
      mp_payment_id: paymentId,
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      amount_cents: amountCents,
      currency,
      status: 'paid',
      shipping_method: fulfillmentMethod ?? 'pending',
      shipping_cost_cents: shippingAmountCents ?? 0,
      metadata: {
        medusa_order_id: medusaOrderId,
        medusa_cart_id: cartId,
        payment_method: 'mercadopago',
        fulfillment_method: fulfillmentMethod ?? null,
        pickup_spot_id: pickupSpotId ?? null,
        shipping_quote: shippingRateId ? {
          rate_id: shippingRateId,
          carrier: shippingCarrier ?? null,
          service: shippingService ?? null,
          amount_cents: shippingAmountCents ?? 0,
          currency: shippingCurrency ?? currency,
          delivery_estimate: shippingDeliveryEstimate ? Number(shippingDeliveryEstimate) : null,
          delivery_label: shippingDeliveryLabel || null,
        } : null,
        ...(offerId ? { offer_id: offerId } : {}),
      },
    })
    if (insertErr) console.error('[mp webhook] Supabase order insert failed:', insertErr)
  }

  // 3. Fire UCP webhook
  deliverOrderWebhook(medusaOrderId ?? cartId, 'order.created').catch(e => console.error('[ucp-webhook] medusa mp:', e))

  // 3. Mark winning offer paid, decline competing offers, close mirror listing
  await markListingPurchased({ listingId: productId, offerId })

  // 4. Telegram admin alert
  const amtFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amountCents / 100)
  tg.salePaid(amtFmt, productId || 'Producto', buyerEmail ?? 'comprador', 'mercadopago')

  // 5. Emails (best-effort via Medusa listing fetch)
  if (productId && buyerEmail) {
    const listingInfo = await getMedusaListing(productId)
    if (listingInfo) {
      const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
      const listingUrl = `${SITE_URL}/l/${productId}`
      const amountFormatted = formatOfferAmount(amountCents, currency)

      sendOrderConfirmedToBuyer({
        buyerEmail,
        buyerName,
        listingTitle: listingInfo.title,
        listingUrl,
        amountPaid: amountFormatted,
        shopName: listingInfo.seller_name,
        isDigital: false,
      }).catch(e => console.error('[mp email] medusa buyer:', e))

      if (listingInfo.seller_clerk_id) {
        getSellerEmail(listingInfo.seller_clerk_id)
          .then(sellerEmail => {
            if (sellerEmail) {
              return sendSaleCompletedToSeller({
                sellerEmail,
                listingTitle: listingInfo.title,
                listingUrl,
                amountPaid: amountFormatted,
                buyerName,
                buyerEmail,
                isDigital: false,
              })
            }
          })
          .catch(e => console.error('[mp email] medusa seller:', e))
      }
    }
  }
}

// ── Preapproval (subscription) handler ───────────────────────────────────────

async function handleMpPreapproval(preapprovalId: string) {
  const pa = await getMpPreapproval(preapprovalId)
  if (!pa) return

  // Map MP status → our status
  const statusMap: Record<string, string> = {
    authorized: 'active',
    paused:     'past_due',
    cancelled:  'canceled',
    pending:    'pending_authorization',
  }
  const newStatus = statusMap[pa.status ?? ''] ?? pa.status ?? 'unknown'

  // Upsert by mp_preapproval_id
  const { data: existing } = await db
    .from('marketplace_subscriptions')
    .select('id, status')
    .eq('mp_preapproval_id', preapprovalId)
    .maybeSingle()

  if (existing) {
    await db.from('marketplace_subscriptions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    // Alert on first activation
    if (existing.status !== 'active' && newStatus === 'active') {
      tg.alert(`✅ MP Suscripción activada\nPreapproval: ${preapprovalId}`)
    }
    if (newStatus === 'canceled') {
      tg.alert(`❌ MP Suscripción cancelada\nPreapproval: ${preapprovalId}`)
    }
  }
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
