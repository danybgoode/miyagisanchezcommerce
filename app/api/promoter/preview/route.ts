/**
 * /api/promoter/preview — a bound promoter mints or revokes the opaque preview
 * link for a merchant's private shop (founding-merchant-consent-previews S1.2).
 *
 *   POST   → ensure the shop's preview anchor + mint a fresh opaque link.
 *   DELETE → revoke every active link for the shop's preview (returns 404 on reopen).
 *
 * Gated by `promoter.private_preview_enabled` (404 when OFF, so the surface is dark
 * for rollback). Promoter-authed exactly like the close/listing route; the token is
 * returned in plaintext ONCE (only its SHA-256 hash is stored). The link renders the
 * proposed shop from the Supabase mirror — it never grants ownership or checkout.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import {
  ensureShopPreview,
  getPreviewByShop,
  mintPreviewGrant,
  revokePreviewGrants,
} from '@/lib/preview-access'

export const dynamic = 'force-dynamic'

// Links default to a 30-day life so a stale share can't linger indefinitely.
const PREVIEW_LINK_TTL_DAYS = 30

async function authorize(req: NextRequest) {
  if (!(await isEnabled('promoter.private_preview_enabled'))) {
    return { error: NextResponse.json({ ok: false }, { status: 404 }) }
  }
  const user = await currentUser().catch(() => null)
  if (!user) return { error: NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 }) }

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Demasiados intentos. Espera un momento.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      ),
    }
  }

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return { error: NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 }) }
  }
  return { user }
}

async function resolveShop(req: NextRequest) {
  let body: { shopId?: string; slug?: string } = {}
  try { body = await req.json() } catch { /* empty ok */ }
  return resolveTargetShop({ shopId: body.shopId, slug: body.slug })
}

function previewUrl(req: NextRequest, token: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
  return `${origin.replace(/\/$/, '')}/preview/${token}`
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  const shop = await resolveShop(req)
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const preview = await ensureShopPreview(shop.id, auth.user.id)
  if (!preview) return NextResponse.json({ ok: false, error: 'No se pudo preparar la vista previa.' }, { status: 500 })

  const minted = await mintPreviewGrant(preview.id, auth.user.id, PREVIEW_LINK_TTL_DAYS)
  if (!minted) return NextResponse.json({ ok: false, error: 'No se pudo generar el enlace.' }, { status: 500 })

  return NextResponse.json({ ok: true, url: previewUrl(req, minted.token) })
}

export async function DELETE(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  const shop = await resolveShop(req)
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const preview = await getPreviewByShop(shop.id)
  if (!preview) return NextResponse.json({ ok: true, revoked: 0 })

  const revoked = await revokePreviewGrants(preview.id)
  return NextResponse.json({ ok: true, revoked })
}
