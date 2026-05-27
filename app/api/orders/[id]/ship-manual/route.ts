/**
 * POST /api/orders/[id]/ship-manual
 *
 * Seller enters carrier + tracking number manually (no Envia label).
 * Transitions order → shipped and notifies buyer.
 *
 * Body:
 *   carrier        string  — e.g. 'dhl', 'fedex', 'estafeta', 'otro'
 *   trackingNumber string  — waybill/guía number
 *   carrierLabel?  string  — human-readable carrier name (for 'otro')
 *
 * Supports both legacy Supabase orders and new Medusa-backed orders.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendOrderShipped } from '@/lib/email'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { carrier?: string; trackingNumber?: string; carrierLabel?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.carrier) return NextResponse.json({ error: 'carrier requerido.' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  let listingTitle = 'tu pedido'
  let shopName = 'Miyagi Sánchez'
  let buyerEmail: string | null = null
  let buyerName: string | null = null

  // ── Medusa order (ID starts with "order_") ────────────────────────────────
  if (id.startsWith('order_')) {
    const { getToken } = await auth()
    const clerkJwt = await getToken()

    // Fetch order from Medusa to get buyer info for email
    try {
      const orderRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}`, {
        headers: {
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
        },
      })
      if (orderRes.ok) {
        const { order } = await orderRes.json() as { order: { buyer_email?: string; buyer_name?: string; marketplace_listings?: { title?: string }; marketplace_shops?: { name?: string } } }
        buyerEmail = order.buyer_email ?? null
        buyerName = order.buyer_name ?? null
        listingTitle = order.marketplace_listings?.title ?? listingTitle
        shopName = order.marketplace_shops?.name ?? shopName
      }
    } catch { /* use defaults */ }

    // Update fulfillment in Medusa — auth enforced by backend
    const medusaRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
        ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
      },
      body: JSON.stringify({
        status: 'shipped',
        carrier: body.carrier,
        tracking_number: body.trackingNumber,
      }),
    })

    if (!medusaRes.ok) {
      const err = await medusaRes.json().catch(() => ({})) as { message?: string }
      return NextResponse.json({ error: err.message ?? 'Error al registrar el envío.' }, { status: medusaRes.status })
    }

    if (buyerEmail) {
      sendOrderShipped({
        buyerEmail,
        buyerName,
        listingTitle,
        orderUrl: `${siteUrl}/account/orders/${id}`,
        carrier: body.carrierLabel ?? body.carrier,
        trackingNumber: body.trackingNumber ?? null,
        estimatedDelivery: null,
        shopName,
      }).catch(e => console.error('[email] orderShipped manual (medusa):', e))
    }

    tg.alert(`📦 Envío manual — ${listingTitle}\nGuía: ${body.trackingNumber ?? 'sin guía'} (${body.carrier})\nComprador: ${buyerEmail ?? '?'}`)
    return NextResponse.json({ status: 'shipped' })
  }

  // ── Legacy Supabase order ─────────────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, buyer_email, buyer_name, shop_id, listing_id, metadata')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  if (!['paid', 'processing'].includes(order.status)) {
    return NextResponse.json({ error: `No se puede enviar un pedido en estado "${order.status}".` }, { status: 422 })
  }

  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const medusaOrderId = meta.medusa_order_id as string | undefined

  // Seller auth check (legacy orders only)
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('clerk_user_id, name')
    .eq('id', order.shop_id)
    .maybeSingle()

  if (!shop || shop.clerk_user_id !== user.id) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  buyerEmail = order.buyer_email
  buyerName = order.buyer_name ?? null

  // Try to enrich listing title
  if (medusaOrderId) {
    try {
      const listingRes = await fetch(`${MEDUSA_BASE}/store/listings/${order.listing_id}`, {
        headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY },
      })
      if (listingRes.ok) {
        const { listing } = await listingRes.json() as { listing?: { title?: string; seller?: { name?: string } } }
        listingTitle = listing?.title ?? listingTitle
        shopName = listing?.seller?.name ?? shopName
      }
    } catch { /* use defaults */ }
  } else {
    const { data: listing } = await db.from('marketplace_listings').select('title').eq('id', order.listing_id).maybeSingle()
    listingTitle = listing?.title ?? listingTitle
  }

  // If also backed by Medusa, update fulfillment there
  if (medusaOrderId) {
    try {
      const { getToken } = await auth()
      const clerkJwt = await getToken()
      await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${medusaOrderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
        },
        body: JSON.stringify({ status: 'shipped', carrier: body.carrier, tracking_number: body.trackingNumber }),
      })
    } catch (e) {
      console.error('[ship-manual] Medusa fulfillment error:', e)
    }
  }

  const { error: shipErr } = await db.from('marketplace_shipments').insert({
    order_id:        id,
    carrier:         body.carrier,
    tracking_number: body.trackingNumber || null,
    label_url:       null,
    status:          'label_created',
    metadata: { manual: true, carrier_label: body.carrierLabel ?? body.carrier },
  })
  if (shipErr) console.error('[ship-manual] shipment insert failed:', shipErr)

  await db.from('marketplace_orders').update({ status: 'shipped', updated_at: new Date().toISOString() }).eq('id', id)

  if (buyerEmail) {
    sendOrderShipped({
      buyerEmail,
      buyerName,
      listingTitle,
      orderUrl: `${siteUrl}/account/orders/${id}`,
      carrier: body.carrierLabel ?? body.carrier,
      trackingNumber: body.trackingNumber ?? null,
      estimatedDelivery: null,
      shopName,
    }).catch(e => console.error('[email] orderShipped manual:', e))
  }

  tg.alert(`📦 Envío manual — ${listingTitle}\nGuía: ${body.trackingNumber ?? 'sin guía'} (${body.carrier})\nComprador: ${buyerEmail}`)

  return NextResponse.json({ status: 'shipped' })
}
