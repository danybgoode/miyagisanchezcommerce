/**
 * POST /api/promoter/claim/link — a bound promoter generates a one-tap WhatsApp
 * claim link for a shop they set up (epic 08 · S4 · US-11). Mirrors
 * the claim flow (sign a shop link + upsert the pending marketplace_claims row)
 * but is promoter-authed and returns a `wa.me` share link instead of emailing —
 * the merchant taps it, logs in, and the existing /api/claim/complete transfers
 * ownership (flips clerk_user_id only → the promoter's attribution survives).
 * Clerk- + `promoter.enabled`-gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/supabase'
import { signClaimToken } from '@/lib/claimJwt'
import { getPromoterByClerkId } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import { buildWhatsAppClaimLink } from '@/lib/promoter-close'
import { normalizedClaimEmail, buildClaimLandingUrl } from '@/lib/claim-invitation'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { readSellerStatus } from '@/lib/admin/tenant-status'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  // Auth gates BEFORE any config/secret check, so an anonymous caller always gets
  // 401 (never a 500 leaking that a prod-only secret is unset on preview).
  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  if (!process.env.CLAIM_JWT_SECRET) {
    console.error('[promoter/claim/link] CLAIM_JWT_SECRET is not set')
    return NextResponse.json({ ok: false, error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }

  let body: { shopId?: string; slug?: string; email?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }

  const shop = await resolveTargetShop({ shopId: body.shopId, slug: body.slug })
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })
  if (shop.clerkUserId) {
    return NextResponse.json({ ok: false, error: 'Esta tienda ya fue reclamada.' }, { status: 409 })
  }

  // The claim token addresses the Medusa seller id (sel_…) — the same identity
  // /api/claim/complete → /internal/sellers/:id/claim transfers. Fall back to the
  // mirror id only if metadata is missing (older rows).
  const claimShopId = shop.medusaSellerId ?? shop.id
  const email = normalizedClaimEmail(body.email)
  if (!email) return NextResponse.json({ ok: false, error: 'Escribe el correo del representante de la tienda.' }, { status: 400 })
  const shopRead = await readShopFresh(shop.slug)
  if (shopRead.state === 'unavailable') return NextResponse.json({ ok: false, error: 'No pudimos comprobar la tienda.' }, { status: 503 })
  if (shopRead.state === 'absent') return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })
  const market = readPublicSellerMarket(shopRead.shop)?.market_code
  const status = await readSellerStatus(claimShopId)
  if (!market || status.state !== 'resolved') {
    return NextResponse.json({ ok: false, error: 'No pudimos verificar la tienda.' }, { status: 503 })
  }
  if (status.status !== 'active') return NextResponse.json({ ok: false, error: 'La tienda no está pública.' }, { status: 409 })
  const token = await signClaimToken({ shopId: claimShopId, shopSlug: shop.slug, shopName: shop.name, market, purpose: 'promoter' }, null)
  const claimUrl = buildClaimLandingUrl(token)

  // Upsert the pending claim against the mirror UUID (marketplace_claims.shop_id
  // FKs marketplace_shops.id), exactly like /api/claim/send. Non-fatal: the claim
  // itself is driven by the self-contained signed JWT (verified at
  // /api/claim/complete), not this row — the row is for admin visibility — so a
  // failed upsert is logged but still returns a working link.
  const { error: claimErr } = await db.from('marketplace_claims').upsert(
    { shop_id: shop.id, clerk_user_id: `pending:${email}`, status: 'pending', message: 'Promoter handoff' },
    { onConflict: 'shop_id,clerk_user_id' },
  )
  if (claimErr) console.error('[promoter/claim/link] pending claim upsert failed (non-fatal):', claimErr.message)

  return NextResponse.json({
    ok: true,
    whatsappLink: buildWhatsAppClaimLink({ claimUrl, shopName: shop.name }),
    claimUrl,
    slug: shop.slug,
  })
}
