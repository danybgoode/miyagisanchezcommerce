/**
 * GET  /api/orders/[id]  — fetch a single order (seller or buyer)
 * PATCH /api/orders/[id] — update order status (seller only)
 *   body: { status: 'processing' | 'delivered' | 'completed', carrier?, tracking_number? }
 *
 * Supports two backends:
 *   - Legacy Supabase orders (no metadata.medusa_order_id)
 *   - New Medusa-backed orders (metadata.medusa_order_id set)
 *     For Medusa orders, status updates go to the new backend endpoint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendOrderDelivered, getSellerEmail } from '@/lib/email'
import { dispatchToBuyer } from '@/lib/notifications/dispatch'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'

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
      created_at, updated_at, metadata,
      marketplace_shipments(
        id, carrier, tracking_number, label_url, status,
        estimated_delivery_date, weight_grams, envia_shipment_id, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const medusaOrderId = meta.medusa_order_id as string | undefined

  // ── Access control ────────────────────────────────────────────────────────
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isBuyer =
    order.buyer_clerk_user_id === user.id ||
    order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  // For Medusa orders, seller is identified by shop_id = Medusa seller ID
  // We can't easily verify seller here without a Medusa lookup, so we check buyer
  // and let the seller portal page control access via their own server-side query
  const isSeller = !isBuyer // simplified: if not buyer, assume seller for now

  // ── For Medusa orders, enrich with Medusa order data ─────────────────────
  let enriched: Record<string, unknown> = { ...order }
  if (medusaOrderId) {
    try {
      const { getToken } = await auth()
      const clerkJwt = await getToken()
      const medusaRes = await fetch(
        `${MEDUSA_BASE}/store/sellers/me/orders/${medusaOrderId}`,
        {
          headers: {
            'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '',
            ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
          },
        }
      )
      if (medusaRes.ok) {
        const { order: medusaOrder } = await medusaRes.json() as { order: Record<string, unknown> }
        // Merge Medusa data (richer) over Supabase record
        enriched = {
          ...enriched,
          ...medusaOrder,
          id: order.id, // keep Supabase ID for routing
          marketplace_shipments: medusaOrder.marketplace_shipments ?? order.marketplace_shipments,
        }
      }
    } catch { /* use Supabase data only */ }
  } else {
    // Legacy: fetch listing + shop from Supabase joins
    const { data: fullOrder } = await db
      .from('marketplace_orders')
      .select(`
        id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
        shipping_address, buyer_name, buyer_email, buyer_clerk_user_id,
        created_at, updated_at, metadata,
        marketplace_listings!inner(id, title, images, listing_type, metadata),
        marketplace_shops!inner(id, name, slug, clerk_user_id, metadata),
        marketplace_shipments(
          id, carrier, tracking_number, label_url, status,
          estimated_delivery_date, weight_grams, envia_shipment_id, created_at
        )
      `)
      .eq('id', id)
      .maybeSingle()
    if (fullOrder) {
      enriched = fullOrder as unknown as Record<string, unknown>
      const shop = (fullOrder as any).marketplace_shops as { clerk_user_id: string | null } | null
      if (shop && shop.clerk_user_id !== user.id && !isBuyer) {
        return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
      }
    }
  }

  return NextResponse.json({ order: enriched, isSeller, isBuyer })
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const SELLER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  paid:       ['processing'],
  processing: ['shipped'],
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

  let body: { status?: string; carrier?: string; tracking_number?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.status) {
    return NextResponse.json({ error: 'status requerido.' }, { status: 400 })
  }

  const newStatus = body.status!

  // ── Medusa-backed order (ID starts with "order_") ─────────────────────────
  if (id.startsWith('order_')) {
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    const PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

    const medusaRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
        ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
      },
      body: JSON.stringify({ status: newStatus, carrier: body.carrier, tracking_number: body.tracking_number }),
    })

    if (!medusaRes.ok) {
      const err = await medusaRes.json().catch(() => ({})) as { message?: string }
      return NextResponse.json({ error: err.message ?? 'Error al actualizar.' }, { status: medusaRes.status })
    }

    return NextResponse.json({ status: newStatus })
  }

  // ── Legacy Supabase order ─────────────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, buyer_email, buyer_name, buyer_clerk_user_id, shop_id, listing_id, metadata')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const medusaOrderId = meta.medusa_order_id as string | undefined

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isBuyer =
    order.buyer_clerk_user_id === user.id ||
    order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()
  const isSeller = !isBuyer

  const currentStatus = order.status
  const allowed = isSeller
    ? (SELLER_ALLOWED_TRANSITIONS[currentStatus] ?? [])
    : (BUYER_ALLOWED_TRANSITIONS[currentStatus] ?? [])

  if (!allowed.includes(newStatus)) {
    return NextResponse.json({
      error: `No se puede cambiar de "${currentStatus}" a "${newStatus}".`,
    }, { status: 422 })
  }

  if (medusaOrderId && isSeller) {
    try {
      const { getToken } = await auth()
      const clerkJwt = await getToken()
      await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${medusaOrderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '',
          ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
        },
        body: JSON.stringify({ status: newStatus, carrier: body.carrier, tracking_number: body.tracking_number }),
      }).catch(e => console.error('[orders PATCH] Medusa update error:', e))
    } catch { /* non-fatal */ }
  }

  const { error } = await db
    .from('marketplace_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[orders PATCH] Supabase update error:', error)
    return NextResponse.json({ error: 'Error al actualizar el estado.' }, { status: 500 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  const orderUrl = `${siteUrl}/account/orders/${id}`

  if (newStatus === 'delivered' || newStatus === 'completed') {
    if (order.buyer_email) {
      let listingTitle = 'tu pedido'
      try {
        const listingRes = await fetch(
          `${MEDUSA_BASE}/store/listings/${order.listing_id}`,
          { headers: { 'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '' } }
        )
        if (listingRes.ok) {
          const { listing } = await listingRes.json() as { listing?: { title?: string } }
          listingTitle = listing?.title ?? listingTitle
        }
      } catch { /* use default */ }

      // Buyer "Envíos" event — gated by the buyer's prefs (guest → email as today).
      void dispatchToBuyer(
        { clerkUserId: order.buyer_clerk_user_id ?? null, email: order.buyer_email },
        {
          group: 'buyer.envios',
          email: to =>
            sendOrderDelivered({
              buyerEmail: to,
              buyerName: order.buyer_name ?? null,
              listingTitle,
              orderUrl,
              shopName: 'Miyagi Sánchez',
            }),
        },
      )
    }

    tg.alert(`📦 Pedido marcado como entregado\nListingID: ${order.listing_id}\nComprador: ${order.buyer_email}`)
  }

  return NextResponse.json({ status: newStatus })
}
