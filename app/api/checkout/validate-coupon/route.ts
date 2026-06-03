/**
 * GET /api/checkout/validate-coupon?sellerId=…&code=…&itemsCents=…
 *
 * Thin proxy to the Medusa backend's /store/sellers/:slug/validate-coupon —
 * real-time coupon preview at checkout. The authoritative re-check happens at
 * start-checkout; this is only so the buyer sees the discount before paying.
 */
import { NextRequest, NextResponse } from 'next/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY     = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sellerId = searchParams.get('sellerId')
  const code = searchParams.get('code') ?? ''
  const itemsCents = searchParams.get('itemsCents') ?? '0'

  if (!sellerId) return NextResponse.json({ valid: false, message: 'sellerId requerido.' }, { status: 400 })
  if (!code.trim()) return NextResponse.json({ valid: false, message: 'Escribe un código.' }, { status: 400 })

  const qs = new URLSearchParams({ code, items_cents: itemsCents })

  try {
    const upstream = await fetch(
      `${MEDUSA_BASE}/store/sellers/${encodeURIComponent(sellerId)}/validate-coupon?${qs}`,
      { headers: { 'x-publishable-api-key': PUB_KEY } },
    )
    const data = await upstream.json().catch(() => null)
    return NextResponse.json(data ?? { valid: false, message: 'Respuesta inválida del servidor.' }, {
      status: upstream.status,
    })
  } catch (err) {
    console.error('[checkout/validate-coupon] backend unreachable:', err)
    return NextResponse.json(
      { valid: false, message: 'No se pudo validar el cupón. Intenta en unos momentos.' },
      { status: 502 },
    )
  }
}
