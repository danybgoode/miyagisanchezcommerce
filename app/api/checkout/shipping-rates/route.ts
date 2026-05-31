/**
 * POST /api/checkout/shipping-rates
 *
 * Thin proxy to the Medusa backend's /store/envia/rates endpoint.
 * All Envia quoting logic lives in the backend (Medusa-first).
 *
 * Body: { listingId?, items?, address }
 * Returns: { rates[], package_count } | { rates: [], message } | { error }
 */
import { NextRequest, NextResponse } from 'next/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY     = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  try {
    const upstream = await fetch(`${MEDUSA_BASE}/store/envia/rates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': PUB_KEY,
      },
      body: JSON.stringify(body),
    })

    const data = await upstream.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Respuesta inválida del servidor.' }, {
      status: upstream.status,
    })
  } catch (err) {
    console.error('[checkout/shipping-rates] backend unreachable:', err)
    return NextResponse.json(
      { error: 'No se pudo conectar con el servidor de envíos. Intenta en unos momentos.' },
      { status: 502 },
    )
  }
}
