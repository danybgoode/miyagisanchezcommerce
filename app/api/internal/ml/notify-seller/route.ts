/**
 * POST /api/internal/ml/notify-seller
 *
 * Bridges an ML order lifecycle event (materialized, shipped, delivered,
 * cancelled — all decided in `apps/backend`) into the existing seller
 * notification seam (ml-orders-native S2 · US-5). The backend already resolves
 * `clerk_user_id` in-process (its own `Seller` module carries it directly — no
 * Supabase round-trip needed) and calls this route the same way
 * `reconcile-checkouts.ts`/`sweepstakes-draw.ts` already call INTO this app:
 * `x-internal-secret` = `MEDUSA_INTERNAL_SECRET`.
 *
 * Routes through the existing `orders` ("Pedidos") event group — no new
 * preference surface. Unlike native Miyagi orders (where shipped/delivered are
 * seller-self-triggered and deliberately NOT echoed back), an ML order's state
 * changes are never seller-initiated in Miyagi, so all four events notify.
 */
import { NextRequest, NextResponse } from 'next/server'
import { dispatchToSeller } from '@/lib/notifications/dispatch'
import { groupForEvent, type SellerEventKind } from '@/lib/notifications/preferences'
import { sendMlOrderEventToSeller } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

type MlNotifyEvent = 'ml_order_new' | 'ml_order_shipped' | 'ml_order_delivered' | 'ml_order_cancelled'

const COPY: Record<
  MlNotifyEvent,
  { subject: string; headline: string; note: string; pushTitle: string; pushBody: string; telegram: string }
> = {
  ml_order_new: {
    subject: '📦 Nueva venta en Mercado Libre',
    headline: 'Recibiste una venta de Mercado Libre',
    note: 'Un pedido de Mercado Libre se agregó a tu bandeja de pedidos. Gestiónalo igual que tus ventas de Miyagi.',
    pushTitle: '📦 Venta de Mercado Libre',
    pushBody: 'Un nuevo pedido de Mercado Libre está en tu bandeja.',
    telegram: '📦 <b>Venta de Mercado Libre</b>\nUn nuevo pedido se agregó a tu bandeja de pedidos.',
  },
  ml_order_shipped: {
    subject: '🚚 Pedido de Mercado Libre enviado',
    headline: 'Tu pedido de Mercado Libre fue enviado',
    note: 'Mercado Libre marcó este pedido como enviado. El estado ya se actualizó en tu bandeja de pedidos.',
    pushTitle: '🚚 Pedido enviado',
    pushBody: 'Un pedido de Mercado Libre fue marcado como enviado.',
    telegram: '🚚 <b>Pedido de Mercado Libre enviado</b>\nEl estado ya se actualizó en tu bandeja.',
  },
  ml_order_delivered: {
    subject: '✅ Pedido de Mercado Libre entregado',
    headline: 'Tu pedido de Mercado Libre fue entregado',
    note: 'Mercado Libre confirmó la entrega. El estado ya se actualizó en tu bandeja de pedidos.',
    pushTitle: '✅ Pedido entregado',
    pushBody: 'Un pedido de Mercado Libre fue entregado.',
    telegram: '✅ <b>Pedido de Mercado Libre entregado</b>\nEl estado ya se actualizó en tu bandeja.',
  },
  ml_order_cancelled: {
    subject: '❌ Pedido de Mercado Libre cancelado',
    headline: 'Un pedido de Mercado Libre fue cancelado',
    note: 'Mercado Libre reportó una cancelación o reembolso. Reabastecimos tu inventario automáticamente.',
    pushTitle: '❌ Pedido cancelado',
    pushBody: 'Mercado Libre reportó una cancelación o reembolso.',
    telegram: '❌ <b>Pedido de Mercado Libre cancelado</b>\nReabastecimos tu inventario automáticamente.',
  },
}

function isMlNotifyEvent(v: unknown): v is MlNotifyEvent {
  return typeof v === 'string' && v in COPY
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret')
  if (!secret || !process.env.MEDUSA_INTERNAL_SECRET || secret !== process.env.MEDUSA_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | { clerkUserId?: string; event?: string; orderId?: string }
    | null
  const clerkUserId = body?.clerkUserId
  const orderId = body?.orderId
  if (!clerkUserId || !orderId || !isMlNotifyEvent(body?.event)) {
    return NextResponse.json({ error: 'clerkUserId, orderId, and a valid event are required' }, { status: 400 })
  }
  const event = body!.event as MlNotifyEvent

  const copy = COPY[event]
  const orderUrl = `${SITE}/shop/manage/orders/${orderId}`

  // Fire-and-forget, same contract as `dispatchToSeller` itself — a notification
  // failure must never surface as a failed materialize/fulfillment/cancel on the
  // backend's side (it doesn't await this response body either).
  await dispatchToSeller(clerkUserId, {
    group: groupForEvent(event as SellerEventKind),
    email: (to) =>
      sendMlOrderEventToSeller({
        sellerEmail: to,
        subject: copy.subject,
        headline: copy.headline,
        note: copy.note,
        orderUrl,
      }),
    push: { kind: 'order', title: copy.pushTitle, body: copy.pushBody, url: orderUrl, tag: `ml-order-${orderId}` },
    telegram: `${copy.telegram}\n<a href="${orderUrl}">Ver pedido</a>`,
  })

  return NextResponse.json({ ok: true })
}
