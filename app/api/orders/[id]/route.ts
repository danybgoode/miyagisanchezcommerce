/**
 * GET  /api/orders/[id]         — fetch a single order (seller or buyer)
 * PATCH /api/orders/[id]        — update order status (seller only)
 *   body: { status: 'processing' | 'delivered' | 'completed' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendOrderDelivered, getSellerEmail } from '@/lib/email'
import { tg } from '@/lib/telegram'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: order, error } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
      shipping_address, buyer_name, buyer_email, buyer_clerk_user_id,
      created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type, metadata),
      marketplace_shops!inner(id, name, slug, clerk_user_id, metadata),
      marketplace_shipments(
        id, carrier, tracking_number, label_url, status,
        estimated_delivery_date, weight_grams, envia_shipment_id, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  // ── Access control ────────────────────────────────────────────────────────
  const shop = order.marketplace_shops as unknown as { clerk_user_id: string | null }
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isSeller = shop.clerk_user_id === user.id
  const isBuyer  =
    order.buyer_clerk_user_id === user.id ||
    order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  if (!isSeller && !isBuyer) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  return NextResponse.json({ order, isSeller, isBuyer })
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const SELLER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  paid:       ['processing'],
  processing: ['shipped'],      // overridden by /ship route; kept as manual fallback
  shipped:    ['in_transit', 'delivered'],
  in_transit: ['delivered'],
}

const BUYER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  shipped:    ['delivered'],
  in_transit: ['delivered'],
  delivered:  ['completed'],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { status?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.status) {
    return NextResponse.json({ error: 'status requerido.' }, { status: 400 })
  }

  // ── Fetch order + auth check ──────────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, buyer_email, buyer_name, buyer_clerk_user_id, marketplace_shops!inner(clerk_user_id, name), marketplace_listings!inner(id, title)')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop    = order.marketplace_shops as unknown as { clerk_user_id: string | null; name: string }
  const listing = order.marketplace_listings as unknown as { id: string; title: string }
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isSeller = shop.clerk_user_id === user.id
  const isBuyer  =
    order.buyer_clerk_user_id === user.id ||
    order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  if (!isSeller && !isBuyer) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  // ── Validate transition ───────────────────────────────────────────────────
  const currentStatus = order.status
  const newStatus     = body.status
  const allowed = isSeller
    ? (SELLER_ALLOWED_TRANSITIONS[currentStatus] ?? [])
    : (BUYER_ALLOWED_TRANSITIONS[currentStatus] ?? [])

  if (!allowed.includes(newStatus)) {
    return NextResponse.json({
      error: `No se puede cambiar de "${currentStatus}" a "${newStatus}".`,
    }, { status: 422 })
  }

  // ── Update ────────────────────────────────────────────────────────────────
  const { error } = await db
    .from('marketplace_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[orders] status update error:', error)
    return NextResponse.json({ error: 'Error al actualizar el estado.' }, { status: 500 })
  }

  // ── Side effects ──────────────────────────────────────────────────────────
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  const orderUrl = `${siteUrl}/account/orders/${id}`

  if (newStatus === 'delivered' || newStatus === 'completed') {
    // Notify buyer to leave a review
    const email = order.buyer_email
    if (email) {
      sendOrderDelivered({
        buyerEmail: email,
        buyerName: order.buyer_name ?? null,
        listingTitle: listing.title,
        orderUrl,
        shopName: shop.name,
      }).catch(e => console.error('[email] orderDelivered:', e))
    }

    if (isSeller) {
      tg.alert(`📦 Pedido marcado como entregado\n${listing.title}\nComprador: ${order.buyer_email}`)
    }
  }

  return NextResponse.json({ status: newStatus })
}
