/**
 * PATCH /api/orders/[id]/return-request/[requestId]
 *   Seller accepts, offers partial refund, or declines a return request.
 *   body: { action: 'accept' | 'partial_refund' | 'decline'; refund_amount_cents?: number; seller_note?: string }
 *
 *   'accept' → full refund (Stripe only for now), status → 'refunded'
 *   'partial_refund' → partial refund, status → 'partial_refund'
 *   'decline' → status → 'declined'
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'
import { sendReturnAcceptedToBuyer, sendReturnDeclinedToBuyer } from '@/lib/email'
import { tg } from '@/lib/telegram'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { action?: string; refund_amount_cents?: number; seller_note?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!['accept', 'partial_refund', 'decline'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Acción inválida. Usa accept, partial_refund o decline.' }, { status: 422 })
  }

  // ── Fetch return request + order + verify seller ──────────────────────────
  const { data: returnReq } = await db
    .from('marketplace_return_requests')
    .select('id, status, buyer_email, buyer_name, order_id')
    .eq('id', requestId)
    .eq('order_id', id)
    .maybeSingle()

  if (!returnReq) return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 })
  if (returnReq.status !== 'pending') {
    return NextResponse.json({ error: 'Esta solicitud ya fue procesada.' }, { status: 422 })
  }

  const { data: order } = await db
    .from('marketplace_orders')
    .select(`
      id, amount_cents, currency, status,
      metadata,
      marketplace_shops!inner(id, name, clerk_user_id),
      marketplace_listings!inner(id, title)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop    = order.marketplace_shops as unknown as { id: string; name: string; clerk_user_id: string | null }
  const listing = order.marketplace_listings as unknown as { id: string; title: string }

  if (shop.clerk_user_id !== user.id) {
    return NextResponse.json({ error: 'Solo el vendedor puede gestionar devoluciones.' }, { status: 403 })
  }

  const siteUrl      = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  const buyerOrderUrl = `${siteUrl}/account/orders/${id}`

  // ── Accept → full Stripe refund ───────────────────────────────────────────
  if (body.action === 'accept') {
    const orderMeta = order.metadata as Record<string, unknown> | null
    const stripePaymentIntentId = orderMeta?.stripe_payment_intent_id as string | undefined
    const stripeChargeId        = orderMeta?.stripe_charge_id as string | undefined

    let stripeRefundId: string | null = null

    if (stripePaymentIntentId || stripeChargeId) {
      try {
        const refund = await stripe.refunds.create({
          ...(stripePaymentIntentId
            ? { payment_intent: stripePaymentIntentId }
            : { charge: stripeChargeId }),
          reason: 'requested_by_customer',
          metadata: { order_id: id, return_request_id: requestId },
        })
        stripeRefundId = refund.id

        // Update order status to refunded
        await db.from('marketplace_orders').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', id)
      } catch (err) {
        console.error('[return-request] stripe refund error:', err)
        // Don't fail — mark as accepted even if Stripe refund needs manual follow-up
      }
    }

    const { error } = await db
      .from('marketplace_return_requests')
      .update({
        status:             stripeRefundId ? 'refunded' : 'accepted',
        refund_amount_cents: order.amount_cents,
        seller_note:        body.seller_note?.trim() || null,
        stripe_refund_id:   stripeRefundId,
        updated_at:         new Date().toISOString(),
      })
      .eq('id', requestId)

    if (error) {
      console.error('[return-request] update error:', error)
      return NextResponse.json({ error: 'Error al actualizar la solicitud.' }, { status: 500 })
    }

    // Notify buyer
    sendReturnAcceptedToBuyer({
      buyerEmail:   returnReq.buyer_email ?? '',
      buyerName:    null,
      listingTitle: listing.title,
      shopName:     shop.name,
      refundAmount: new Intl.NumberFormat('es-MX', { style: 'currency', currency: order.currency ?? 'MXN', maximumFractionDigits: 0 }).format(order.amount_cents / 100),
      isPartial:    false,
      sellerNote:   body.seller_note?.trim() ?? null,
      orderUrl:     buyerOrderUrl,
    }).catch(e => console.error('[email] returnAccepted:', e))

    tg.alert(`✅ Devolución aceptada\n${listing.title}\n${stripeRefundId ? `Refund: ${stripeRefundId}` : 'Sin refund Stripe (manual)'}`)
      .catch(() => {})

    return NextResponse.json({ status: stripeRefundId ? 'refunded' : 'accepted' })
  }

  // ── Partial refund ────────────────────────────────────────────────────────
  if (body.action === 'partial_refund') {
    const refundCents = body.refund_amount_cents
    if (!refundCents || refundCents <= 0 || refundCents > order.amount_cents) {
      return NextResponse.json({ error: 'Monto de reembolso parcial inválido.' }, { status: 422 })
    }

    const orderMeta = order.metadata as Record<string, unknown> | null
    const stripePaymentIntentId = orderMeta?.stripe_payment_intent_id as string | undefined
    const stripeChargeId        = orderMeta?.stripe_charge_id as string | undefined

    let stripeRefundId: string | null = null

    if (stripePaymentIntentId || stripeChargeId) {
      try {
        const refund = await stripe.refunds.create({
          ...(stripePaymentIntentId
            ? { payment_intent: stripePaymentIntentId }
            : { charge: stripeChargeId }),
          amount: refundCents,
          reason: 'requested_by_customer',
          metadata: { order_id: id, return_request_id: requestId, type: 'partial' },
        })
        stripeRefundId = refund.id
      } catch (err) {
        console.error('[return-request] stripe partial refund error:', err)
      }
    }

    await db
      .from('marketplace_return_requests')
      .update({
        status:             'partial_refund',
        refund_amount_cents: refundCents,
        seller_note:        body.seller_note?.trim() || null,
        stripe_refund_id:   stripeRefundId,
        updated_at:         new Date().toISOString(),
      })
      .eq('id', requestId)

    const refundFormatted = new Intl.NumberFormat('es-MX', { style: 'currency', currency: order.currency ?? 'MXN', maximumFractionDigits: 0 }).format(refundCents / 100)

    sendReturnAcceptedToBuyer({
      buyerEmail:   returnReq.buyer_email ?? '',
      buyerName:    null,
      listingTitle: listing.title,
      shopName:     shop.name,
      refundAmount: refundFormatted,
      isPartial:    true,
      sellerNote:   body.seller_note?.trim() ?? null,
      orderUrl:     buyerOrderUrl,
    }).catch(e => console.error('[email] returnPartial:', e))

    tg.alert(`🔁 Reembolso parcial\n${listing.title}\n${refundFormatted}${stripeRefundId ? ` · ${stripeRefundId}` : ''}`)
      .catch(() => {})

    return NextResponse.json({ status: 'partial_refund', stripeRefundId })
  }

  // ── Decline ───────────────────────────────────────────────────────────────
  await db
    .from('marketplace_return_requests')
    .update({
      status:      'declined',
      seller_note: body.seller_note?.trim() || null,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', requestId)

  sendReturnDeclinedToBuyer({
    buyerEmail:   returnReq.buyer_email ?? '',
    buyerName:    null,
    listingTitle: listing.title,
    shopName:     shop.name,
    sellerNote:   body.seller_note?.trim() ?? null,
    orderUrl:     buyerOrderUrl,
  }).catch(e => console.error('[email] returnDeclined:', e))

  tg.alert(`❌ Devolución rechazada\n${listing.title}`)
    .catch(() => {})

  return NextResponse.json({ status: 'declined' })
}
