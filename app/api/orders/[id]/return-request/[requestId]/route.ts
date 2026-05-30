/**
 * PATCH /api/orders/[id]/return-request/[requestId]
 *   Seller accepts (full/partial refund) or declines a return request.
 *   body: { action: 'accept' | 'partial_refund' | 'decline'; refund_amount_cents?: number; seller_note?: string }
 *
 * Routes to Medusa backend for Medusa order IDs (order_*).
 * Sends emails via Resend after backend processes the action.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { sendReturnAcceptedToBuyer, sendReturnDeclinedToBuyer, getSellerEmail } from '@/lib/email'
import { tg } from '@/lib/telegram'
import { db } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY    = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { action?: string; refund_amount_cents?: number; seller_note?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!['accept', 'partial_refund', 'decline'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

  // ── Medusa path ───────────────────────────────────────────────────────────
  if (id.startsWith('order_')) {
    const clerkJwt = await getToken()
    if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

    // Map partial_refund → accept with refund_amount_cents
    const medusaAction = body.action === 'partial_refund' ? 'accept' : body.action

    const res = await medusaFetch(`/store/sellers/me/orders/${id}/return-request`, clerkJwt, {
      method: 'PATCH',
      body: JSON.stringify({
        action: medusaAction,
        refund_amount_cents: body.refund_amount_cents,
      }),
    })
    const data = await res.json() as { refunded?: boolean; refund_status?: string; refund_amount_cents?: number; message?: string }
    if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error al procesar la devolución.' }, { status: res.status })

    // Send emails (best-effort)
    try {
      const orderRes = await medusaFetch(`/store/sellers/me/orders/${id}`, clerkJwt)
      if (orderRes.ok) {
        const orderData = await orderRes.json() as { order?: Record<string, unknown> }
        const order = orderData.order ?? {}
        const listings = order.marketplace_listings as Record<string, unknown> | undefined
        const listingTitle = (listings?.title as string) ?? 'Producto'
        const buyerEmail   = (order.buyer_email as string) ?? ''
        const shopName     = 'Tu tienda'
        const refundAmountCents = data.refund_amount_cents ?? 0
        const refundFormatted   = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(refundAmountCents / 100)

        if (body.action === 'decline') {
          sendReturnDeclinedToBuyer({ buyerEmail, buyerName: null, listingTitle, shopName, sellerNote: body.seller_note?.trim() ?? null, orderUrl: `${siteUrl}/account/orders/${id}` }).catch(() => {})
          tg.alert(`❌ Devolución rechazada (Medusa)\n${listingTitle}`).catch(() => {})
        } else {
          sendReturnAcceptedToBuyer({ buyerEmail, buyerName: null, listingTitle, shopName, refundAmount: refundFormatted, isPartial: body.action === 'partial_refund', sellerNote: body.seller_note?.trim() ?? null, orderUrl: `${siteUrl}/account/orders/${id}` }).catch(() => {})
          tg.alert(`✅ Devolución aceptada (Medusa)\n${listingTitle}\nReembolso: ${refundFormatted}`).catch(() => {})
        }
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ status: data.refund_status ?? (body.action === 'decline' ? 'declined' : 'accepted') })
  }

  // ── Legacy Supabase path ──────────────────────────────────────────────────
  const { data: returnReq } = await db
    .from('marketplace_return_requests')
    .select('id, status, buyer_email, buyer_name, order_id')
    .eq('id', requestId).eq('order_id', id).maybeSingle()

  if (!returnReq) return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 })
  if (returnReq.status !== 'pending') return NextResponse.json({ error: 'Esta solicitud ya fue procesada.' }, { status: 422 })

  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, amount_cents, currency, status, metadata, marketplace_shops!inner(id, name, clerk_user_id), marketplace_listings!inner(id, title)')
    .eq('id', id).maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })
  const shop    = order.marketplace_shops as unknown as { id: string; name: string; clerk_user_id: string | null }
  const listing = order.marketplace_listings as unknown as { id: string; title: string }
  if (shop.clerk_user_id !== userId) return NextResponse.json({ error: 'Solo el vendedor puede gestionar devoluciones.' }, { status: 403 })

  const buyerOrderUrl = `${siteUrl}/account/orders/${id}`

  if (body.action === 'accept') {
    const meta = order.metadata as Record<string, unknown> | null
    const stripePaymentIntentId = meta?.stripe_payment_intent_id as string | undefined
    const stripeChargeId        = meta?.stripe_charge_id as string | undefined
    let stripeRefundId: string | null = null
    if (stripePaymentIntentId || stripeChargeId) {
      try {
        const refund = await stripe.refunds.create({
          ...(stripePaymentIntentId ? { payment_intent: stripePaymentIntentId } : { charge: stripeChargeId }),
          reason: 'requested_by_customer',
          metadata: { order_id: id, return_request_id: requestId },
        })
        stripeRefundId = refund.id
        await db.from('marketplace_orders').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', id)
      } catch (err) { console.error('[return] stripe refund error:', err) }
    }
    await db.from('marketplace_return_requests').update({ status: stripeRefundId ? 'refunded' : 'accepted', refund_amount_cents: order.amount_cents, seller_note: body.seller_note?.trim() || null, stripe_refund_id: stripeRefundId, updated_at: new Date().toISOString() }).eq('id', requestId)
    const refundFormatted = new Intl.NumberFormat('es-MX', { style: 'currency', currency: order.currency ?? 'MXN', maximumFractionDigits: 0 }).format(order.amount_cents / 100)
    sendReturnAcceptedToBuyer({ buyerEmail: returnReq.buyer_email ?? '', buyerName: null, listingTitle: listing.title, shopName: shop.name, refundAmount: refundFormatted, isPartial: false, sellerNote: body.seller_note?.trim() ?? null, orderUrl: buyerOrderUrl }).catch(() => {})
    tg.alert(`✅ Devolución aceptada\n${listing.title}${stripeRefundId ? `\n${stripeRefundId}` : ''}`).catch(() => {})
    return NextResponse.json({ status: stripeRefundId ? 'refunded' : 'accepted' })
  }

  if (body.action === 'partial_refund') {
    const refundCents = body.refund_amount_cents
    if (!refundCents || refundCents <= 0) return NextResponse.json({ error: 'Monto inválido.' }, { status: 422 })
    const meta = order.metadata as Record<string, unknown> | null
    const stripePaymentIntentId = meta?.stripe_payment_intent_id as string | undefined
    let stripeRefundId: string | null = null
    if (stripePaymentIntentId) {
      try { const r = await stripe.refunds.create({ payment_intent: stripePaymentIntentId, amount: refundCents, reason: 'requested_by_customer' }); stripeRefundId = r.id } catch (e) { console.error('[return] partial refund error:', e) }
    }
    await db.from('marketplace_return_requests').update({ status: 'partial_refund', refund_amount_cents: refundCents, seller_note: body.seller_note?.trim() || null, stripe_refund_id: stripeRefundId, updated_at: new Date().toISOString() }).eq('id', requestId)
    const refundFormatted = new Intl.NumberFormat('es-MX', { style: 'currency', currency: order.currency ?? 'MXN', maximumFractionDigits: 0 }).format(refundCents / 100)
    sendReturnAcceptedToBuyer({ buyerEmail: returnReq.buyer_email ?? '', buyerName: null, listingTitle: listing.title, shopName: shop.name, refundAmount: refundFormatted, isPartial: true, sellerNote: body.seller_note?.trim() ?? null, orderUrl: buyerOrderUrl }).catch(() => {})
    tg.alert(`🔁 Reembolso parcial\n${listing.title}\n${refundFormatted}`).catch(() => {})
    return NextResponse.json({ status: 'partial_refund' })
  }

  // Decline
  await db.from('marketplace_return_requests').update({ status: 'declined', seller_note: body.seller_note?.trim() || null, updated_at: new Date().toISOString() }).eq('id', requestId)
  sendReturnDeclinedToBuyer({ buyerEmail: returnReq.buyer_email ?? '', buyerName: null, listingTitle: listing.title, shopName: shop.name, sellerNote: body.seller_note?.trim() ?? null, orderUrl: buyerOrderUrl }).catch(() => {})
  tg.alert(`❌ Devolución rechazada\n${listing.title}`).catch(() => {})
  return NextResponse.json({ status: 'declined' })
}
