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
import { resolveOrigin } from '@/lib/request-origin'
import {
  canAnchorPreview,
  ensureShopPreview,
  getPreviewByShop,
  mintPreviewGrant,
  revokePreviewGrants,
} from '@/lib/preview-access'
import { readApprovalState, checkActivation } from '@/lib/preview-consent'

export const dynamic = 'force-dynamic'

// Links default to a 30-day life so a stale share can't linger indefinitely.
const PREVIEW_LINK_TTL_DAYS = 30

async function authorize(req: NextRequest) {
  // `promoter.enabled` FIRST, matching all seven sibling close/* routes — the
  // program kill-switch must kill this route too, not just its own feature flag.
  if (!(await isEnabled('promoter.enabled'))) {
    return { error: NextResponse.json({ ok: false }, { status: 404 }) }
  }
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
  return { user, promoter }
}

/**
 * Resolve the shop AND enforce that it belongs to the calling promoter.
 * `resolveTargetShop` deliberately doesn't filter by promoter, so without this a
 * bound promoter could mint or revoke a preview link for another promoter's
 * merchant. A non-owned shop returns the same 404 as a missing one — never
 * confirming that someone else's shop exists.
 */
async function resolveOwnedShop(req: NextRequest, promoterCode: string) {
  let body: { shopId?: string; slug?: string } = {}
  try { body = await req.json() } catch { /* empty ok */ }
  return resolveOwnedShopBySelector({ shopId: body.shopId, slug: body.slug }, promoterCode)
}

async function resolveOwnedShopBySelector(
  selector: { shopId?: string | null; slug?: string | null },
  promoterCode: string,
) {
  const shop = await resolveTargetShop(selector)
  if (!shop) return null
  if (!canAnchorPreview(shop, promoterCode)) return null
  return shop
}

/**
 * Build the shareable preview URL. Uses the shared `resolveOrigin` helper rather
 * than an inline `NEXT_PUBLIC_SITE_URL ?? req.url.origin` fallback — that inline
 * pattern is exactly what PR #248 removed from 11 routes after it minted a broken
 * `https://0.0.0.0:8080/...` URL, and `new URL(req.url).origin` would additionally
 * mint the link on a tenant's custom domain/subdomain when the promoter happens to
 * be on one. Throws loudly instead of handing back a dead link.
 */
function previewUrl(req: NextRequest, token: string): string {
  const origin = resolveOrigin({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    host: req.headers.get('host'),
  })
  return `${origin}/preview/${token}`
}

/**
 * GET → the promoter workspace reads the current consent state for a shop it owns:
 * whether a preview exists, its lifecycle status, whether an approval has gone
 * stale (with plain-language reasons), and whether the shop can be activated right
 * now. Every field is derived server-side from the single `readApprovalState`
 * read + the pure `canActivate` rule, so the workspace, the merchant page and the
 * activation route can never disagree about consent.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  const { searchParams } = new URL(req.url)
  const shop = await resolveOwnedShopBySelector(
    { shopId: searchParams.get('shopId'), slug: searchParams.get('slug') },
    auth.promoter.code,
  )
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const preview = await getPreviewByShop(shop.id)
  if (!preview) {
    return NextResponse.json({ ok: true, exists: false })
  }

  const state = await readApprovalState(preview)
  if (!state) {
    return NextResponse.json({ ok: true, exists: true, status: preview.status, readable: false })
  }

  const gate = await checkActivation(preview)

  return NextResponse.json({
    ok: true,
    exists: true,
    readable: true,
    status: preview.status,
    productCount: state.snapshot.products.length,
    stale: state.stale,
    staleReasons: state.staleReasons,
    approved: state.approvedHash !== null,
    canActivate: gate.ok,
    activateReason: gate.ok ? null : gate.reason,
  })
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  const shop = await resolveOwnedShop(req, auth.promoter.code)
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const preview = await ensureShopPreview(shop.id, auth.user.id)
  if (!preview) return NextResponse.json({ ok: false, error: 'No se pudo preparar la vista previa.' }, { status: 500 })

  // An activated shop is already public — token resolution rejects activated
  // previews, so minting here would hand back a link that always 404s.
  if (preview.status === 'activated') {
    return NextResponse.json(
      { ok: false, error: 'Esta tienda ya es pública; no necesita un enlace privado.' },
      { status: 409 },
    )
  }

  const minted = await mintPreviewGrant(preview.id, auth.user.id, PREVIEW_LINK_TTL_DAYS)
  if (!minted) return NextResponse.json({ ok: false, error: 'No se pudo generar el enlace.' }, { status: 500 })

  return NextResponse.json({ ok: true, url: previewUrl(req, minted.token) })
}

export async function DELETE(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  const shop = await resolveOwnedShop(req, auth.promoter.code)
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const preview = await getPreviewByShop(shop.id)
  if (!preview) return NextResponse.json({ ok: true, revoked: 0 })

  const revoked = await revokePreviewGrants(preview.id)
  // null = the write FAILED (distinct from 0 = nothing left to revoke). Never
  // report a successful revocation for a link that may still resolve.
  if (revoked === null) {
    return NextResponse.json(
      { ok: false, error: 'No se pudo revocar el enlace. Inténtalo de nuevo.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true, revoked })
}
