/**
 * GET /api/embed/shop?key=emb_pk_…
 *
 * Public resolver for the embeddable widget: given a shop's PUBLISHABLE embed
 * key, return that shop's public identity (slug, name, verified, logo, accent)
 * so the widget loader can render + theme itself. CORS-open — it is called from
 * any third-party origin where the widget is pasted.
 *
 * A missing / malformed / unknown key is "not recognized" → 404 with
 * { valid: false }. No PII, no secrets — only what already renders on the
 * public storefront.
 *
 * 07 · Embeddable Widget, Sprint 1 (US-1). Theming detail grows in Sprint 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveEmbedShop, embedKeyFromRequest } from '@/lib/embed-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { CACHE, storefrontCacheControl } from '@/lib/cache-policy'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // Shop IDENTITY (slug, name, verified, logo, accent) → the SHOP window (changes rarely).
  'Access-Control-Allow-Headers': 'Content-Type, x-miyagi-embed-key',
  'Cache-Control': storefrontCacheControl(CACHE.SHOP),
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  // Public + scriptable from any page → rate-limit per IP (no-op without Redis).
  const rl = await checkRateLimit('embed', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes.' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const key = embedKeyFromRequest(req)
  const shop = await resolveEmbedShop(key)

  if (!shop) {
    return NextResponse.json({ valid: false }, { status: 404, headers: CORS })
  }

  const settings = ((shop.metadata ?? {}) as Record<string, unknown>).settings as Record<string, unknown> | undefined
  const theme = (settings?.theme ?? {}) as Record<string, unknown>
  const accent_color = (theme.accent_color as string | null | undefined) ?? null

  return NextResponse.json(
    {
      valid: true,
      shop: {
        slug: shop.slug,
        name: shop.name,
        verified: !!shop.verified,
        logo_url: shop.logo_url,
        accent_color,
      },
    },
    { headers: CORS },
  )
}
