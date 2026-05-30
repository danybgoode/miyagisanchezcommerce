/**
 * POST /api/orders/[id]/confirm-delivery
 *
 * Buyer confirms delivery. For Medusa orders (order_*): proxies to
 * POST /store/customers/me/orders/:id/confirm-delivery which handles escrow capture.
 * For legacy Supabase orders: marks status as 'completed'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Medusa-backed order
  if (id.startsWith('order_')) {
    const res = await fetch(`${MEDUSA_BASE}/store/customers/me/orders/${id}/confirm-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
        Authorization: `Bearer ${clerkJwt}`,
      },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json(data, { status: res.status })
    return NextResponse.json(data)
  }

  // Legacy Supabase order
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, buyer_clerk_user_id, buyer_email')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })
  const isBuyer = order.buyer_clerk_user_id === user.id || order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()
  if (!isBuyer) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const { error } = await db
    .from('marketplace_orders')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'No se pudo actualizar el pedido.' }, { status: 500 })
  return NextResponse.json({ confirmed: true })
}
