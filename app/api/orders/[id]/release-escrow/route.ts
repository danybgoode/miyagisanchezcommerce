/**
 * POST /api/orders/[id]/release-escrow
 *
 * Seller manually releases escrow (buyer confirmed verbally, or auto-confirm window elapsed).
 * Proxies to POST /store/sellers/me/orders/:id/release-escrow on the Medusa backend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Solo se puede liberar escrow de pedidos Medusa.' }, { status: 422 })
  }

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}/release-escrow`, {
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
