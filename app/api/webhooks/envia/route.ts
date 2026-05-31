/**
 * POST /api/webhooks/envia
 *
 * Receives tracking status updates from Envia.com.
 * Set the webhook URL in the Envia dashboard → Developer → Webhooks.
 *
 * Signature verification: Envia sends an HMAC-SHA256 signature in the
 * `X-Webhook-Signature` header using ENVIA_WEBHOOK_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/supabase'

const MEDUSA_BASE            = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY         = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const MEDUSA_INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

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

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function verifySignature(req: NextRequest, rawBody: string, secret: string) {
  const signature = req.headers.get('x-webhook-signature') ?? ''
  const timestamp = req.headers.get('x-webhook-timestamp') ?? ''
  const event = req.headers.get('x-webhook-event') ?? ''

  if (signature && timestamp && event) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${event}.${rawBody}`)
      .digest('hex')
    return signature
      .split(',')
      .some(part => safeCompare(part.trim(), `v1=${expected}`))
  }

  const legacySignature = req.headers.get('x-envia-signature') ?? ''
  if (legacySignature) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    return safeCompare(legacySignature, expected)
  }

  return false
}

function stringValue(value: unknown) {
  if (value == null) return undefined
  return String(value)
}

function normalizedStatus(status: string) {
  return status.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const authToken = process.env.ENVIA_WEBHOOK_AUTH_TOKEN
  let hasValidAuthorization = false
  if (authToken) {
    const authorization = req.headers.get('authorization') ?? ''
    if (!safeCompare(authorization, `Bearer ${authToken}`)) {
      console.error('[envia-webhook] invalid authorization')
      return NextResponse.json({ error: 'Invalid authorization' }, { status: 401 })
    }
    hasValidAuthorization = true
  }

  // ── Signature verification ────────────────────────────────────────────────
  const secret = process.env.ENVIA_WEBHOOK_SECRET
  if (secret) {
    const hasSignatureHeaders = !!req.headers.get('x-webhook-signature')
    if (hasSignatureHeaders && !verifySignature(req, rawBody, secret)) {
      console.error('[envia-webhook] invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    if (!hasSignatureHeaders && !hasValidAuthorization) {
      console.error('[envia-webhook] missing signature')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventData = (payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload) as Record<string, unknown>

  const enviaShipmentId = stringValue(eventData.shipment_id ?? eventData.shipmentId)
  const enviaStatus     = stringValue(eventData.status)
  const normalizedEnviaStatus = enviaStatus ? normalizedStatus(enviaStatus) : undefined
  const trackingNumber  = stringValue(eventData.tracking_number ?? eventData.trackingNumber)
  // Envia echoes back the reference we set at label creation (our orderId for Medusa orders)
  const reference       = stringValue(eventData.reference ?? eventData.externalReference)

  if ((!enviaShipmentId && !trackingNumber) || !normalizedEnviaStatus) {
    return NextResponse.json({ received: true }) // unknown event shape — ignore
  }

  // ── Medusa order path ─────────────────────────────────────────────────────
  // If the reference is a Medusa order ID, route to the backend tracking-update
  // endpoint. This runs in parallel with the Supabase path so both are covered.
  const medusaOrderId = reference?.startsWith('order_') ? reference : null
  if (medusaOrderId) {
    fetch(`${MEDUSA_BASE}/store/envia/tracking-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
        ...(MEDUSA_INTERNAL_SECRET ? { 'x-internal-secret': MEDUSA_INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({
        orderId: medusaOrderId,
        enviaStatus: normalizedEnviaStatus,
        trackingNumber,
        enviaShipmentId,
      }),
    }).then(r => {
      if (!r.ok) r.json().then(d => console.error('[envia-webhook] Medusa update failed:', d)).catch(() => {})
      else console.log(`[envia-webhook] Medusa ${medusaOrderId} → ${normalizedEnviaStatus}`)
    }).catch(e => console.error('[envia-webhook] Medusa backend unreachable:', e))
  }

  // ── Lookup shipment in our DB (legacy Supabase orders) ────────────────────
  let shipmentQuery = db
    .from('marketplace_shipments')
    .select('id, order_id, status')

  shipmentQuery = enviaShipmentId
    ? shipmentQuery.eq('envia_shipment_id', enviaShipmentId)
    : shipmentQuery.eq('tracking_number', trackingNumber)

  const { data: shipment } = await shipmentQuery
    .maybeSingle()

  if (!shipment) {
    console.warn('[envia-webhook] unknown shipment:', enviaShipmentId ?? trackingNumber)
    return NextResponse.json({ received: true })
  }

  const newShipmentStatus = ENVIA_TO_SHIPMENT_STATUS[normalizedEnviaStatus] ?? normalizedEnviaStatus
  const newOrderStatus    = ENVIA_TO_ORDER_STATUS[normalizedEnviaStatus]

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

  console.log(`[envia-webhook] ${enviaShipmentId ?? trackingNumber} -> ${newShipmentStatus}`)
  return NextResponse.json({ received: true })
}
