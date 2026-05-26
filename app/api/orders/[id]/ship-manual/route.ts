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
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendOrderShipped } from '@/lib/email'
import { tg } from '@/lib/telegram'

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
  // trackingNumber can be empty for some local couriers; we allow it but nudge

  // ── Fetch order + seller check ────────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, buyer_email, buyer_name, marketplace_shops!inner(id, clerk_user_id, name), marketplace_listings!inner(title)')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop    = order.marketplace_shops as unknown as { clerk_user_id: string | null; name: string }
  const listing = order.marketplace_listings as unknown as { title: string }

  if (shop.clerk_user_id !== user.id) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  if (!['paid', 'processing'].includes(order.status)) {
    return NextResponse.json({ error: `No se puede enviar un pedido en estado "${order.status}".` }, { status: 422 })
  }

  // ── Insert shipment record ────────────────────────────────────────────────
  await db.from('marketplace_shipments').insert({
    order_id:        id,
    carrier:         body.carrier,
    tracking_number: body.trackingNumber || null,
    label_url:       null,
    status:          'label_created',
    metadata: {
      manual: true,
      carrier_label: body.carrierLabel ?? body.carrier,
    },
  })

  // ── Update order status → shipped ─────────────────────────────────────────
  await db
    .from('marketplace_orders')
    .update({ status: 'shipped', updated_at: new Date().toISOString() })
    .eq('id', id)

  // ── Notify buyer ──────────────────────────────────────────────────────────
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  if (order.buyer_email) {
    sendOrderShipped({
      buyerEmail:       order.buyer_email,
      buyerName:        order.buyer_name ?? null,
      listingTitle:     listing.title,
      orderUrl:         `${siteUrl}/account/orders/${id}`,
      carrier:          body.carrierLabel ?? body.carrier,
      trackingNumber:   body.trackingNumber ?? null,
      estimatedDelivery: null,
      shopName:         shop.name,
    }).catch(e => console.error('[email] orderShipped manual:', e))
  }

  tg.alert(`📦 Envío manual — ${listing.title}\nGuía: ${body.trackingNumber ?? 'sin guía'} (${body.carrier})\nComprador: ${order.buyer_email}`)

  return NextResponse.json({ status: 'shipped' })
}
