/**
 * GET /api/checkout/options?sellerId=…&listingType=…&isDigital=…
 *
 * Thin proxy to the Medusa backend's /store/sellers/:slug/checkout-options —
 * the single source of truth for which payment + delivery methods a seller
 * offers. All availability logic lives in the backend (Medusa-first).
 *
 * `sellerId` may be a seller id OR slug (the backend resolves either).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { applyPaymentKillSwitches } from '@/lib/checkout-killswitch'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY     = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sellerId = searchParams.get('sellerId')
  const listingType = searchParams.get('listingType') ?? 'product'
  const isDigital = searchParams.get('isDigital') ?? 'false'

  if (!sellerId) {
    return NextResponse.json({ error: 'sellerId requerido.' }, { status: 400 })
  }

  const qs = new URLSearchParams({ listing_type: listingType, is_digital: isDigital })

  try {
    const upstream = await fetch(
      `${MEDUSA_BASE}/store/sellers/${encodeURIComponent(sellerId)}/checkout-options?${qs}`,
      { headers: { 'x-publishable-api-key': PUB_KEY } },
    )
    const data = await upstream.json().catch(() => null)
    if (data == null) {
      return NextResponse.json({ error: 'Respuesta inválida del servidor.' }, { status: upstream.status })
    }
    // Apply platform kill-switches to the success payload. The flag read is
    // fail-open (isEnabled → true if the flag store is unreachable), so Stripe is
    // only ever removed on a deliberate dashboard toggle. Error bodies (no
    // payment_methods array) pass through untouched.
    const stripeEnabled = upstream.ok ? await isEnabled('checkout.stripe_enabled') : true
    const filtered = applyPaymentKillSwitches(data, { stripeEnabled })
    return NextResponse.json(filtered, { status: upstream.status })
  } catch (err) {
    console.error('[checkout/options] backend unreachable:', err)
    return NextResponse.json(
      { error: 'No se pudo cargar las opciones de pago. Intenta en unos momentos.' },
      { status: 502 },
    )
  }
}
