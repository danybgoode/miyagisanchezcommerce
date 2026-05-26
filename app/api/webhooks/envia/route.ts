/**
 * POST /api/webhooks/envia
 *
 * Receives tracking status updates from Envia.com.
 * Set the webhook URL in the Envia dashboard → Developer → Webhooks.
 *
 * Signature verification: Envia sends an HMAC-SHA256 signature in the
 * `X-Envia-Signature` header using ENVIA_WEBHOOK_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/supabase'

// Envia status → our order status mapping
const ENVIA_TO_ORDER_STATUS: Record<string, string> = {
  picked_up:         'in_transit',
  in_transit:        'in_transit',
  out_for_delivery:  'in_transit',
  delivered:         'delivered',
  exception:         'shipped',    // stay at shipped; seller must investigate
  cancelled:         'shipped',
}

// Envia status → our shipment status
const ENVIA_TO_SHIPMENT_STATUS: Record<string, string> = {
  label_created:    'label_created',
  picked_up:        'picked_up',
  in_transit:       'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered:        'delivered',
  exception:        'exception',
  cancelled:        'cancelled',
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // ── Signature verification ────────────────────────────────────────────────
  const secret = process.env.ENVIA_WEBHOOK_SECRET
  if (secret) {
    const signature = req.headers.get('x-envia-signature') ?? ''
    const expected  = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.error('[envia-webhook] invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const enviaShipmentId = payload.shipmentId as string | undefined
  const enviaStatus     = payload.status     as string | undefined
  const trackingNumber  = payload.trackingNumber as string | undefined

  if (!enviaShipmentId || !enviaStatus) {
    return NextResponse.json({ received: true }) // unknown event shape — ignore
  }

  // ── Lookup shipment in our DB ─────────────────────────────────────────────
  const { data: shipment } = await db
    .from('marketplace_shipments')
    .select('id, order_id, status')
    .eq('envia_shipment_id', enviaShipmentId)
    .maybeSingle()

  if (!shipment) {
    console.warn('[envia-webhook] unknown shipment:', enviaShipmentId)
    return NextResponse.json({ received: true })
  }

  const newShipmentStatus = ENVIA_TO_SHIPMENT_STATUS[enviaStatus] ?? enviaStatus
  const newOrderStatus    = ENVIA_TO_ORDER_STATUS[enviaStatus]

  // ── Update shipment record ────────────────────────────────────────────────
  await db
    .from('marketplace_shipments')
    .update({
      status:         newShipmentStatus,
      tracking_number: trackingNumber ?? undefined,
      updated_at:     new Date().toISOString(),
      metadata:       {
        last_envia_event: payload,
        updated_at: new Date().toISOString(),
      },
    })
    .eq('id', shipment.id)

  // ── Cascade status to order ───────────────────────────────────────────────
  if (newOrderStatus && shipment.order_id) {
    // Only advance — never go backwards
    const { data: order } = await db
      .from('marketplace_orders')
      .select('status')
      .eq('id', shipment.order_id)
      .maybeSingle()

    const ORDER_RANK: Record<string, number> = {
      pending: 0, paid: 1, processing: 2, shipped: 3,
      in_transit: 4, delivered: 5, completed: 6,
    }

    const currentRank = ORDER_RANK[order?.status ?? ''] ?? 0
    const newRank     = ORDER_RANK[newOrderStatus] ?? 0

    if (newRank > currentRank) {
      await db
        .from('marketplace_orders')
        .update({ status: newOrderStatus, updated_at: new Date().toISOString() })
        .eq('id', shipment.order_id)
    }
  }

  console.log(`[envia-webhook] ${enviaShipmentId} → ${newShipmentStatus}`)
  return NextResponse.json({ received: true })
}
