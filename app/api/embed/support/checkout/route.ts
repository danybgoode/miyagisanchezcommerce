import { NextRequest, NextResponse } from 'next/server'
import { embedKeyFromRequest, looksLikeEmbedKey, resolveEmbedShop } from '@/lib/embed-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { coerceSupportSettings, validateSupportContribution } from '@/lib/support-widget'
import { startCheckout, type CheckoutProvider } from '@/lib/cart'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-miyagi-embed-key',
}

type SupportCheckoutBody = {
  embed_key?: string
  provider?: string
  amount_cents?: number
  supporter_name?: string
  supporter_email?: string
  message?: string
  visibility?: 'public' | 'private'
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null
  return email
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name ? name.slice(0, 80) : null
}

function originDomain(req: NextRequest): string | undefined {
  const origin = req.headers.get('origin')
  if (origin) return origin
  const referer = req.headers.get('referer')
  if (referer) return referer
  return undefined
}

function providerAvailable(provider: CheckoutProvider, metadata: Record<string, unknown> | null) {
  if (provider === 'stripe') {
    const stripe = getShopStripe(metadata)
    return !!(stripe.enabled !== false && stripe.charges_enabled && stripe.account_id)
  }
  if (provider === 'mercadopago') return sellerHasMpConnected(metadata)
  return false
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit('embed', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes.' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: SupportCheckoutBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400, headers: CORS })
  }

  const key = embedKeyFromRequest(req) ?? (looksLikeEmbedKey(body.embed_key) ? body.embed_key : null)
  const shop = await resolveEmbedShop(key)
  const metadata = (shop?.metadata ?? null) as Record<string, unknown> | null
  const settings = (metadata?.settings ?? {}) as Record<string, unknown>
  const support = coerceSupportSettings(settings.support)

  if (!shop || !key || !support.enabled || !support.support_product_id) {
    return NextResponse.json({ error: 'Apoyos no disponibles.' }, { status: 404, headers: CORS })
  }

  const provider = body.provider === 'stripe' || body.provider === 'mercadopago'
    ? body.provider
    : null
  if (!provider) {
    return NextResponse.json({ error: 'Método de pago no disponible.', code: 'PROVIDER_INVALID' }, { status: 422, headers: CORS })
  }
  if (!providerAvailable(provider, metadata)) {
    return NextResponse.json({ error: 'Este vendedor aún no tiene ese método de pago activo.', code: 'PROVIDER_UNAVAILABLE' }, { status: 422, headers: CORS })
  }

  const supporterEmail = cleanEmail(body.supporter_email)
  if (!supporterEmail) {
    return NextResponse.json({ error: 'Ingresa un correo válido para el recibo.', field: 'supporter_email' }, { status: 422, headers: CORS })
  }

  const contribution = validateSupportContribution(support, body.amount_cents, body.message)
  if (!contribution.ok) {
    return NextResponse.json({ error: contribution.error, field: 'amount_cents' }, { status: 422, headers: CORS })
  }

  try {
    const result = await startCheckout({
      productId: support.support_product_id,
      provider,
      buyerEmail: supporterEmail,
      fulfillmentMethod: 'digital',
      originDomain: originDomain(req),
      support: {
        amount_cents: contribution.amount_cents,
        supporter_name: cleanName(body.supporter_name),
        supporter_email: supporterEmail,
        message: contribution.message,
        visibility: body.visibility === 'private' || body.visibility === 'public'
          ? body.visibility
          : support.default_visibility,
        embed_key: key,
        channel: 'embed',
      },
    })

    return NextResponse.json(
      {
        checkout_url: result.redirect_url,
        redirect_url: result.redirect_url,
        cart_id: result.cart_id,
        payment_session_id: result.payment_session_id,
      },
      { headers: CORS },
    )
  } catch (error) {
    console.error('[embed/support/checkout] startCheckout failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo iniciar el apoyo.' },
      { status: 502, headers: CORS },
    )
  }
}
