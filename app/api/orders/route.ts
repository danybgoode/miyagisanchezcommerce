/**
 * GET /api/orders?role=seller — seller's orders for their shop
 * GET /api/orders?role=buyer  — buyer's own orders (by clerk ID or email)
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const role = searchParams.get('role') ?? 'buyer'
  const status = searchParams.get('status') // optional filter

  if (role === 'seller') {
    // ── Seller: fetch their shop's orders ──────────────────────────────────
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('id')
      .eq('clerk_user_id', user.id)
      .maybeSingle()

    if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

    let query = db
      .from('marketplace_orders')
      .select(`
        id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
        shipping_address, buyer_name, buyer_email, created_at, updated_at,
        marketplace_listings!inner(id, title, images, listing_type),
        marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date, label_url)
      `)
      .eq('shop_id', shop.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (status) {
      query = query.eq('status', status)
    }

    const { data: orders, error } = await query
    if (error) {
      console.error('[orders] seller fetch error:', error)
      return NextResponse.json({ error: 'Error al obtener pedidos.' }, { status: 500 })
    }

    return NextResponse.json({ orders: orders ?? [] })
  }

  // ── Buyer: fetch their own orders ────────────────────────────────────────
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  let query = db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method, shipping_address,
      buyer_name, buyer_email, created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type),
      marketplace_shops!inner(id, name, slug),
      marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date, label_url)
    `)
    .or(`buyer_clerk_user_id.eq.${user.id},buyer_email.ilike.${buyerEmail}`)
    .order('created_at', { ascending: false })
    .limit(100)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: orders, error } = await query
  if (error) {
    console.error('[orders] buyer fetch error:', error)
    return NextResponse.json({ error: 'Error al obtener pedidos.' }, { status: 500 })
  }

  return NextResponse.json({ orders: orders ?? [] })
}
