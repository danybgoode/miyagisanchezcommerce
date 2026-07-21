/**
 * POST /api/promoter/preview/activate — the ONE deliberate action that makes an
 * approved private preview public (founding-merchant-consent-previews S2.3).
 *
 * Preconditions, all enforced server-side (never trusted from the client):
 *  - the caller is the bound promoter who OWNS this unclaimed shop (canAnchorPreview),
 *  - the preview has a CURRENT approval — an approval whose snapshot hash still
 *    matches what would be published right now (checkActivation → the pure
 *    `canActivate` rule the UI and specs also read).
 *
 * Run order is what makes it safe + replay-safe (scope: "public channels light up
 * only after the canonical Medusa write"): publish every draft product FIRST, then
 * flip the anchor to `activated` (which is what actually un-hides the public shell).
 * A partial publish leaves the anchor `approved` → the shell stays private → nothing
 * is half-public, and re-running republishes (Medusa publish is idempotent) and
 * flips the anchor. Repeat activation on an already-activated preview is a no-op.
 *
 * Checkout stays claim-gated regardless: an unclaimed shop's checkout is blocked by
 * isShopClaimed(), so activation publishes the storefront without opening a purchase
 * an unclaimed merchant couldn't fulfill.
 *
 * Gated by `promoter.enabled` + `promoter.private_preview_enabled` (404 when OFF).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/supabase'
import { getPromoterByClerkId } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import { patchSellerProductViaInternal } from '@/lib/seller-products'
import {
  canAnchorPreview,
  getPreviewByShop,
} from '@/lib/preview-access'
import { checkActivation, markActivated } from '@/lib/preview-consent'

export const dynamic = 'force-dynamic'

async function authorize(req: NextRequest) {
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

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth.error) return auth.error

  let body: { shopId?: string; slug?: string } = {}
  try { body = await req.json() } catch { /* empty ok */ }

  const shop = await resolveTargetShop({ shopId: body.shopId, slug: body.slug })
  // Non-owned or claimed shop → the same 404 as a missing one (never confirm
  // someone else's shop exists; a claimed shop is the merchant's to publish).
  if (!shop || !canAnchorPreview(shop, auth.promoter.code)) {
    return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })
  }

  const preview = await getPreviewByShop(shop.id)
  if (!preview) {
    return NextResponse.json({ ok: false, error: 'Esta tienda no tiene una vista previa que activar.' }, { status: 404 })
  }

  // Already public — idempotent success (a double-click or a retry after a slow
  // response must not error or double-publish).
  if (preview.status === 'activated') {
    return NextResponse.json({ ok: true, alreadyActivated: true })
  }

  const gate = await checkActivation(preview)
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 409 })
  }

  // Canonical Medusa write FIRST. Publish the exact approved product set.
  const productIds = gate.snapshot.products.map((p) => p.id).filter(Boolean)
  const failures: string[] = []
  for (const productId of productIds) {
    const res = await patchSellerProductViaInternal(shop.slug, productId, { status: 'published' })
    if (!res.ok) failures.push(productId)
  }
  if (failures.length > 0) {
    // Anchor stays `approved` → the public shell is still hidden → nothing is
    // half-public. The promoter can retry; republishing what already published is
    // a no-op, so the retry is safe.
    return NextResponse.json(
      { ok: false, error: 'No se pudieron publicar todos los productos. Inténtalo de nuevo.', published: productIds.length - failures.length, failed: failures.length },
      { status: 502 },
    )
  }

  // Mirror status → active for the published products, so the Supabase-backed
  // read seams (search, privacy guard's public-listings check) agree with Medusa.
  if (productIds.length > 0) {
    await db
      .from('marketplace_listings')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('shop_id', shop.id)
      .in('medusa_product_id', productIds)
  }

  // Flip the anchor LAST — this is what un-hides the public shell. A failure here
  // leaves everything published but the shell still private; the promoter retries
  // and this idempotent flip completes.
  const flipped = await markActivated(preview.id)
  if (!flipped) {
    return NextResponse.json(
      { ok: false, error: 'Los productos se publicaron pero no se pudo activar la tienda. Inténtalo de nuevo.' },
      { status: 500 },
    )
  }

  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, activated: true, published: productIds.length })
}
