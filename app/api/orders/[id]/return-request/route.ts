/**
 * POST /api/orders/[id]/return-request  — buyer opens a return request
 * GET  /api/orders/[id]/return-request  — get return requests for this order
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sendReturnRequestToSeller, sendReturnRequestConfirmedToBuyer, getSellerEmail } from '@/lib/email'
import { tg } from '@/lib/telegram'

const VALID_REASONS = ['not_as_described', 'damaged', 'wrong_item', 'changed_mind', 'other'] as const

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Fetch order + verify access
  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, buyer_email, buyer_clerk_user_id, marketplace_shops!inner(clerk_user_id)')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop = order.marketplace_shops as unknown as { clerk_user_id: string | null }
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isSeller = shop.clerk_user_id === user.id
  const isBuyer = order.buyer_clerk_user_id === user.id || order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()
  if (!isSeller && !isBuyer) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })

  const { data: requests } = await db
    .from('marketplace_return_requests')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests ?? [] })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { reason?: string; description?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.reason || !VALID_REASONS.includes(body.reason as typeof VALID_REASONS[number])) {
    return NextResponse.json({ error: 'Motivo de devolución inválido.' }, { status: 422 })
  }

  // ── Fetch order and verify buyer access ───────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, buyer_email, buyer_name, buyer_clerk_user_id, shop_id,
      marketplace_listings!inner(id, title),
      marketplace_shops!inner(id, name, clerk_user_id)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop    = order.marketplace_shops as unknown as { id: string; name: string; clerk_user_id: string | null }
  const listing = order.marketplace_listings as unknown as { id: string; title: string }
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''
  const isBuyer = order.buyer_clerk_user_id === user.id || order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  if (!isBuyer) return NextResponse.json({ error: 'Solo el comprador puede abrir una devolución.' }, { status: 403 })

  // Only allow return requests on delivered/completed orders
  if (!['delivered', 'completed'].includes(order.status)) {
    return NextResponse.json({ error: 'Solo puedes solicitar una devolución después de recibir el pedido.' }, { status: 422 })
  }

  // Check if a return request already exists
  const { data: existing } = await db
    .from('marketplace_return_requests')
    .select('id, status')
    .eq('order_id', id)
    .maybeSingle()

  if (existing && existing.status !== 'declined') {
    return NextResponse.json({ error: 'Ya existe una solicitud de devolución para este pedido.', requestId: existing.id }, { status: 409 })
  }

  // ── Create return request ─────────────────────────────────────────────────
  const { data: returnRequest, error: insertError } = await db
    .from('marketplace_return_requests')
    .insert({
      order_id:            id,
      shop_id:             shop.id,
      buyer_clerk_user_id: user.id,
      buyer_email:         buyerEmail || order.buyer_email,
      reason:              body.reason,
      description:         body.description?.trim() || null,
      status:              'pending',
    })
    .select('id')
    .single()

  if (insertError || !returnRequest) {
    console.error('[return-request] insert error:', insertError)
    return NextResponse.json({ error: 'Error al crear la solicitud.' }, { status: 500 })
  }

  // Flag the order
  await db
    .from('marketplace_orders')
    .update({ return_requested_at: new Date().toISOString() })
    .eq('id', id)

  // ── Side effects ──────────────────────────────────────────────────────────
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  const orderUrl = `${siteUrl}/shop/manage/orders/${id}`
  const buyerOrderUrl = `${siteUrl}/account/orders/${id}`

  // Notify seller
  if (shop.clerk_user_id) {
    const sellerEmail = await getSellerEmail(shop.clerk_user_id)
    if (sellerEmail) {
      sendReturnRequestToSeller({
        sellerEmail,
        shopName:     shop.name,
        buyerName:    order.buyer_name ?? null,
        buyerEmail:   (buyerEmail || order.buyer_email) ?? '',
        listingTitle: listing.title,
        reason:       body.reason,
        description:  body.description?.trim() ?? null,
        orderUrl,
      }).catch(e => console.error('[email] returnRequestToSeller:', e))
    }
  }

  // Confirm to buyer
  sendReturnRequestConfirmedToBuyer({
    buyerEmail:   (buyerEmail || order.buyer_email) ?? '',
    buyerName:    order.buyer_name ?? null,
    listingTitle: listing.title,
    shopName:     shop.name,
    orderUrl:     buyerOrderUrl,
  }).catch(e => console.error('[email] returnRequestToBuyer:', e))

  tg.alert(`↩ Solicitud de devolución\n${listing.title}\nMotivo: ${body.reason}\nComprador: ${buyerEmail}`)
    .catch(() => {})

  return NextResponse.json({ requestId: returnRequest.id }, { status: 201 })
}
