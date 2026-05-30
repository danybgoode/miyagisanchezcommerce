/**
 * PATCH /api/orders/[id]/confirm-payment
 *
 * Seller marks SPEI/cash payment as received. Proxies to
 * PATCH /store/sellers/me/orders/:id/confirm-payment on the Medusa backend.
 * Only valid for Medusa-backed orders with payment_method 'spei' or 'cash'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Solo se puede confirmar el pago de pedidos Medusa.' }, { status: 422 })
  }

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}/confirm-payment`, {
    method: 'PATCH',
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
