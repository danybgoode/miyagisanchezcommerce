import { NextRequest, NextResponse } from 'next/server'
import { embedKeyFromRequest, resolveEmbedShop } from '@/lib/embed-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { coerceSupportSettings } from '@/lib/support-widget'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-miyagi-embed-key',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
}

function supportProviders(metadata: Record<string, unknown> | null) {
  const stripe = getShopStripe(metadata)
  return {
    stripe: !!(stripe.enabled !== false && stripe.charges_enabled && stripe.account_id),
    mercadopago: sellerHasMpConnected(metadata),
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit('embed', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes.' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const key = embedKeyFromRequest(req)
  const shop = await resolveEmbedShop(key)
  const metadata = (shop?.metadata ?? null) as Record<string, unknown> | null
  const settings = (metadata?.settings ?? {}) as Record<string, unknown>
  const support = coerceSupportSettings(settings.support)

  if (!shop || !support.enabled || !support.support_product_id) {
    return NextResponse.json({ valid: false }, { status: 404, headers: CORS })
  }

  const theme = (settings.theme ?? {}) as Record<string, unknown>
  const providers = supportProviders(metadata)

  return NextResponse.json(
    {
      valid: true,
      shop: {
        slug: shop.slug,
        name: shop.name,
        verified: !!shop.verified,
        logo_url: shop.logo_url,
        accent_color: (theme.accent_color as string | null | undefined) ?? null,
      },
      support: {
        enabled: true,
        preset_amount_cents: support.preset_amount_cents,
        custom_min_cents: support.custom_min_cents,
        custom_max_cents: support.custom_max_cents,
        currency: support.currency,
        default_visibility: support.default_visibility,
      },
      payment_providers: providers,
      disabled_reason: providers.stripe || providers.mercadopago ? null : 'payment_provider_required',
    },
    { headers: CORS },
  )
}
