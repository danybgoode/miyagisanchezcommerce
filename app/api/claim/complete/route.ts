/**
 * Claim completion — the marketplace half of the shop-claim handshake
 * (Gem → Claimable Shop Loop · S2.2).
 *
 * A vetted invitation lands the owner at /claim, which authenticates through
 * Clerk before calling this endpoint. Ownership truth lives on the Medusa seller
 * (`clerk_user_id` drives the "Sin reclamar" badge, /shop/manage and
 * /store/sellers/me), so this endpoint:
 *   1. re-verifies the claim JWT (shared CLAIM_JWT_SECRET),
 *   2. sets the Medusa seller's clerk_user_id via POST /internal/sellers/:id/claim,
 *   3. claims the Supabase mirror row (conversations / offers / agent tooling),
 *   4. approves the marketplace_claims record and busts the shop page cache.
 *
 *   POST /api/claim/complete   body: { token }
 *   Auth: Clerk session, or the legacy dashboard's shared-secret caller. In
 *   both cases this endpoint loads Clerk's verified email before transfer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { clerkClient, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { verifyClaimToken } from '@/lib/claimJwt'
import { decideClaimRedemption } from '@/lib/claim-invitation'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { readSellerStatus } from '@/lib/admin/tenant-status'
import { verifiedClerkEmailAddresses } from '@/lib/founding-operator-activation'
import { sendShopClaimedWelcome } from '@/lib/email'
import { tg } from '@/lib/telegram'
import { emitPreviewEvent } from '@/lib/preview-lifecycle'
import { emitMerchantLifecycleForShop } from '@/lib/merchant-lifecycle-server'
import { sendGrowthEvent } from '@/lib/growth-engine'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export async function POST(req: NextRequest) {
  // The historical dashboard may still call with the shared secret. The new
  // Miyagi claim page calls with the Clerk session; its body cannot choose an id.
  const sharedSecret = process.env.CLAIM_JWT_SECRET
  if (!sharedSecret) console.error('[claim/complete] CLAIM_JWT_SECRET missing')
  if (!sharedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const serverCaller = req.headers.get('x-claim-secret') === sharedSecret
  if (!INTERNAL_SECRET) {
    console.error('[claim/complete] MEDUSA_INTERNAL_SECRET missing')
    return NextResponse.json({ error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }

  let body: { token?: string; clerk_user_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.token) {
    return NextResponse.json({ error: 'Falta el enlace de invitación.' }, { status: 400 })
  }
  const user = serverCaller
    ? body.clerk_user_id?.trim()
      ? await (await clerkClient()).users.getUser(body.clerk_user_id.trim()).catch(() => null)
      : null
    : await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 })
  const clerkUserId = user.id

  let payload
  try {
    payload = await verifyClaimToken(body.token)
  } catch {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 400 })
  }

  // The claim page tokenizes the Medusa seller id (sel_…). Tolerate older
  // tokens that carried a Supabase mirror UUID by resolving it to the Medusa id.
  let sellerId = payload.shopId
  if (!sellerId.startsWith('sel_')) {
    const { data: mirror } = await db
      .from('marketplace_shops')
      .select('metadata')
      .eq('id', sellerId)
      .maybeSingle()
    const medusaId = (mirror?.metadata as Record<string, unknown> | null)?.medusa_seller_id
    if (typeof medusaId !== 'string' || !medusaId) {
      return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
    }
    sellerId = medusaId
  }

  // A link proves control of an inbox, not business ownership. Only an invite
  // issued to a vetted contact may auto-transfer, and only to a Clerk account
  // where that same address is verified. A public self-submitted email remains
  // a human-review request. Medusa status is read fresh, never from a cached
  // public shop projection, because a removal request may have paused it.
  const shopRead = await readShopFresh(payload.shopSlug, payload.market)
  if (shopRead.state === 'unavailable') return NextResponse.json({ error: 'No pudimos comprobar la tienda. Intenta más tarde.' }, { status: 503 })
  if (shopRead.state === 'absent') return NextResponse.json({ error: 'Tienda no disponible.' }, { status: 404 })
  const shop = shopRead.shop
  const status = await readSellerStatus(sellerId)
  if (status.state !== 'resolved') {
    return NextResponse.json({ error: 'No pudimos comprobar el estado de la tienda. Intenta más tarde.' }, { status: 503 })
  }
  const market = readPublicSellerMarket(shop)?.market_code ?? null
  const decision = decideClaimRedemption(
    { ...payload, shopId: sellerId },
    { id: shop.id, slug: shop.slug, clerkUserId: shop.clerk_user_id, market, status: status.status },
    { clerkUserId, verifiedEmails: verifiedClerkEmailAddresses(user.emailAddresses) },
  )
  if (payload.campaignId) {
    await sendGrowthEvent({ userId: sellerId, event: 'campaign.claim_attempted',
      featureId: 'claim-shop-acquisition', tags: { campaign_id: payload.campaignId, market } })
  }
  if (!decision.ok) {
    const messages = {
      review_required: 'Esta solicitud necesita revisión. Responde al correo de confirmación para que podamos ayudarte.',
      wrong_email: 'Inicia sesión con el correo verificado al que enviamos esta invitación.',
      wrong_shop: 'La invitación no corresponde a esta tienda.',
      wrong_market: 'La invitación no corresponde al mercado de esta tienda.',
      shop_unavailable: 'Esta tienda no está disponible para reclamar.',
      already_claimed: 'Esta tienda ya pertenece a otra cuenta.',
    }
    return NextResponse.json({ error: messages[decision.reason] }, { status: decision.reason === 'wrong_shop' ? 404 : 409 })
  }

  // ── 1. Transfer ownership on the Medusa seller (source of truth) ───────────
  const claimRes = await fetch(`${MEDUSA_BASE}/internal/sellers/${sellerId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({ clerk_user_id: clerkUserId }),
  })
  const claimData = await claimRes.json().catch(() => ({})) as {
    seller?: { slug?: string }
    message?: string
    newly_claimed?: boolean
  }

  if (claimRes.status === 404) {
    return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
  }
  if (claimRes.status === 409) {
    return NextResponse.json({ error: claimData.message ?? 'La tienda ya fue reclamada.' }, { status: 409 })
  }
  if (!claimRes.ok) {
    console.error('[claim/complete] internal claim failed:', claimRes.status, claimData)
    return NextResponse.json({ error: 'No se pudo reclamar la tienda' }, { status: 502 })
  }

  // ── 2+3. Mirror row + pending-claim bookkeeping (both non-fatal) ───────────
  // marketplace_claims.shop_id is a UUID FK to the MIRROR row, so resolve it
  // once and use it for both updates.
  const { data: mirrorRow } = await db
    .from('marketplace_shops')
    .select('id')
    .contains('metadata', { medusa_seller_id: sellerId })
    .maybeSingle()

  if (mirrorRow) {
    const { error: mirrorErr } = await db
      .from('marketplace_shops')
      .update({ clerk_user_id: clerkUserId, updated_at: new Date().toISOString() })
      .eq('id', mirrorRow.id)
      .is('clerk_user_id', null)
    if (mirrorErr) console.error('[claim/complete] mirror claim failed (non-fatal):', mirrorErr)

    await db
      .from('marketplace_claims')
      .update({ status: 'approved' })
      .eq('shop_id', mirrorRow.id)
  } else {
    console.error('[claim/complete] no mirror row for seller', sellerId, '(non-fatal)')
  }

  // ── 4. Shop page stops showing "Sin reclamar" without waiting out ISR ──────
  revalidateTag('shops', { expire: 0 })
  revalidateTag('listings', { expire: 0 })

  const slug = claimData.seller?.slug ?? payload.shopSlug

  // The old backend returned the same `claimed: true` on first transfer and
  // idempotent retry. Its new `newly_claimed` bit is the only safe trigger for
  // once-only email/telemetry; missing means deploy lag and must not guess.
  const newlyClaimed = claimData.newly_claimed === true
  if (newlyClaimed) {
    tg.newShop(payload.shopName, null, slug)
    await sendShopClaimedWelcome({ to: payload.email, shopName: payload.shopName, shopSlug: slug, market: market ?? 'mx', sellerId })
    if (payload.campaignId) {
      await sendGrowthEvent({ userId: sellerId, event: 'campaign.claim_completed',
        featureId: 'claim-shop-acquisition', tags: { campaign_id: payload.campaignId, market } })
    }
    if (payload.invitationId) {
      const { error: conversionError } = await db.from('claim_campaign_invitations')
        .update({ claimed_at: new Date().toISOString() }).eq('id', payload.invitationId).eq('seller_id', sellerId)
      if (conversionError) console.error('[claim/complete] invitation conversion update failed', conversionError)
    }
  }

  // Consent-previews lifecycle telemetry (S3.1) — the claim is the last canonical
  // transition in the founding-merchant funnel. Emitted after ownership actually
  // transferred, keyed on the mirror id only (no name, email or token). Skipped
  // when the mirror row couldn't be resolved — there is no non-PII subject then.
  if (mirrorRow && newlyClaimed) {
    await emitPreviewEvent('shop_claimed', { shopId: mirrorRow.id as string })
    // The same moment as a merchant lifecycle fact (event-destination-router S3.1),
    // carrying the merchant subject Golden Beans routes the delivery back on. Once
    // per merchant — the earlier 404/409 branches already prevent a re-claim, and the
    // emission claim covers the rest. `...ForShop` (Sprint 3, README D1) resolves the
    // shop mirror id onto its relationship id — the actual subject key — before
    // calling the seam; this route only ever knows the shop.
    await emitMerchantLifecycleForShop('merchant.claimed', { shopId: mirrorRow.id as string })
  }

  return NextResponse.json({
    ok: true,
    shopName: payload.shopName,
    shopSlug: slug,
    newlyClaimed,
  })
}
