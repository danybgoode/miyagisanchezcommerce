/**
 * POST /api/promoter/close/subdomain — a bound promoter activates the subdomain
 * SKU on a MERCHANT'S behalf (epic 08 · promoter-funnel-v2 S3 · US-3.2), after
 * collecting cash in person (or as part of a bundle close). Mirrors
 * `/api/promoter/close/domain` (S4 · US-10) — decouples the PAYER (the promoter)
 * from the GRANTEE (the target shop, possibly unclaimed).
 *
 * The Sprint 3 twist: when the admin has configured the subdomain's per-SKU
 * promoter price at $0 (US-3.1 — the free-first-year perk), this activates
 * DIRECTLY (grantFreeSubdomainYear — no Stripe checkout, no charge, no redirect)
 * instead of returning a checkout URL. Any other price (no override, or a
 * partial discount) falls through to the existing paid one-time Stripe checkout
 * (`startSubdomainCheckout`) — so this route works correctly whether or not the
 * free-year perk is configured, never assuming it.
 *
 * Promoter Funnel v2 · Sprint 4 (US-4.1) — when the body carries
 * `paymentMethod: 'transfer'` (behind `promoter.transfer_enabled`, fail-open OFF)
 * AND the resolved price is NOT the $0 free-year perk, this starts a
 * net-remittance (SPEI/DiMo/CoDi) transfer INSTEAD of a Stripe checkout — the
 * $0 free-year perk stays a direct grant (no transfer needed, nothing to remit).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { detectChannel } from '@/lib/channel'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId, getPromoterSkuPrices } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import { startSubdomainCheckout } from '@/lib/subdomain-subscription-checkout'
import { grantFreeSubdomainYear } from '@/lib/promoter-subdomain-grant-server'
import { isOneTimeGrantLive } from '@/lib/domain-entitlement'
import { readSubdomainGrant } from '@/lib/subdomain-entitlement'
import { hasActiveSubdomainSubscription } from '@/lib/subdomain-subscription'
import { SUBDOMAIN_PRICE_YEARLY_CENTS } from '@/lib/subdomain-pricing'
import { startPromoterTransferClose } from '@/lib/promoter-transfers'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  let body: { shopId?: string; slug?: string; paymentMethod?: string; transferMethod?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }

  const shop = await resolveTargetShop({ shopId: body.shopId, slug: body.slug })
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  const skuPrices = await getPromoterSkuPrices()
  const isFree = skuPrices.subdomain === 0

  if (isFree) {
    // The $0 free-year perk is a direct grant regardless of paymentMethod — there
    // is nothing to remit, so a promoter picking "Transferir" here still gets the
    // instant free activation, never a $0 transfer request.
    // Refuse a redundant free-year grant when the shop is ALREADY entitled via an
    // existing grant or an active paid subscription — independent of the paywall
    // flag (a shop can hold a real entitlement even while the flag is off).
    // Mirrors the "already active" guard the paid path (startSubdomainCheckout)
    // already has; caught missing here in fresh cross-agent review of PR 165 —
    // without it, a promoter could silently overwrite a paying shop's grant
    // metadata and log a misleading $0-paid attribution.
    const existingGrant = readSubdomainGrant(shop.metadata)
    const alreadyGranted = existingGrant?.type === 'grandfather' || existingGrant?.type === 'comp' || isOneTimeGrantLive(existingGrant)
    const alreadySubscribed = shop.clerkUserId ? await hasActiveSubdomainSubscription(shop.clerkUserId) : false
    if (alreadyGranted || alreadySubscribed) {
      return NextResponse.json({ ok: false, error: 'Esta tienda ya tiene el subdominio activo.', alreadyActive: true }, { status: 409 })
    }

    const result = await grantFreeSubdomainYear({
      shopId: shop.id,
      promoterId: promoter.id,
      sellerClerkId: shop.clerkUserId ?? '',
    })
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, free: true })
  }

  if (body.paymentMethod === 'transfer') {
    if (!(await isEnabled('promoter.transfer_enabled'))) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }
    const transferResult = await startPromoterTransferClose({
      promoter,
      sku: 'subdomain',
      basePriceCents: SUBDOMAIN_PRICE_YEARLY_CENTS,
      sellerId: shop.id,
      transferMethod: body.transferMethod,
    })
    if (!transferResult.ok) return NextResponse.json({ ok: false, error: transferResult.error }, { status: transferResult.status })
    return NextResponse.json({ ok: true, transfer: transferResult.transfer })
  }

  // Fall through to the paid one-time checkout — the standard discount (global or
  // a partial per-SKU override) still applies via startSubdomainCheckout's own
  // resolvePromoterDiscount call (Sprint 3 · US-3.1).
  const result = await startSubdomainCheckout({
    shopId: shop.id,
    sellerClerkId: shop.clerkUserId ?? '',
    buyerEmail: user.emailAddresses?.[0]?.emailAddress,
    channel: detectChannel(req),
    cadence: 'one_time',
    promoterCode: promoter.code,
    paidByPromoter: true,
  })
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.alreadyActive ? { alreadyActive: true } : {}) },
      { status: result.status },
    )
  }
  return NextResponse.json({ ok: true, free: false, url: result.url })
}
