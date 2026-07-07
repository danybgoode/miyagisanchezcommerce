import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * GET /api/sell/profit/fee-estimate?product_id=&price_cents= — proxies to
 * the backend's ML fee-rate read (Sprint 2 · US-4). Read-only: the backend
 * owns product-ownership + the ML link lookup, so this route only needs the
 * seller's Clerk JWT to reach the Store API.
 */
export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const productId = req.nextUrl.searchParams.get('product_id') ?? ''
  const priceCents = req.nextUrl.searchParams.get('price_cents') ?? ''
  if (!productId || !priceCents) {
    return NextResponse.json({ error: 'product_id y price_cents son requeridos.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  try {
    const params = new URLSearchParams({ product_id: productId, price_cents: priceCents })
    const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/profit/fee-estimate?${params.toString()}`, {
      headers: { 'x-publishable-api-key': PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ available: false })
    const d = await res.json()
    return NextResponse.json(d)
  } catch {
    return NextResponse.json({ available: false })
  }
}
