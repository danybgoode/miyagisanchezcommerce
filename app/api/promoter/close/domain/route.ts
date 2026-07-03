/**
 * POST /api/promoter/close/domain — a bound promoter pays the one-time custom-domain
 * SKU on a MERCHANT'S behalf (epic 08 · S4 · US-10), after collecting cash in person.
 *
 * The key new mechanic: decouple the PAYER (the promoter, authenticated here) from
 * the GRANTEE (the target shop, possibly unclaimed). The S2 builder + webhook already
 * grant to `shop_id` from metadata and attribute to that shop — only the seller-self
 * route (`/api/sell/shop/domain/subscribe`) hardcoded "own shop". This route resolves
 * the TARGET shop instead, passes the promoter's OWN code (real discount + attribution)
 * and `paidByPromoter: true` for provenance. Entitlement + commission land on the
 * seller; the charge is on the promoter's card. Clerk- + `promoter.enabled`-gated.
 *
 * Promoter Funnel v2 · Sprint 4 (US-4.1) — when the body carries
 * `paymentMethod: 'transfer'` (behind `promoter.transfer_enabled`, fail-open OFF),
 * this starts a net-remittance (SPEI/DiMo/CoDi) transfer INSTEAD of a Stripe
 * checkout: the owed amount (price − commission) comes from the same
 * `resolvePromoterDiscount` deriver every Stripe branch already uses, and NOTHING
 * activates yet — that only happens once Daniel approves the reported transfer
 * (see /api/admin/promoter/transfers/[id]/approve).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { detectChannel } from '@/lib/channel'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import { startCustomDomainCheckout } from '@/lib/domain-subscription-checkout'
import { CUSTOM_DOMAIN_PRICE_CENTS } from '@/lib/domain-pricing'
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

  if (body.paymentMethod === 'transfer') {
    if (!(await isEnabled('promoter.transfer_enabled'))) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }
    const result = await startPromoterTransferClose({
      promoter,
      sku: 'custom_domain',
      basePriceCents: CUSTOM_DOMAIN_PRICE_CENTS,
      sellerId: shop.id,
      transferMethod: body.transferMethod,
    })
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, transfer: result.transfer })
  }

  const result = await startCustomDomainCheckout({
    shopId: shop.id,
    // Empty for an unclaimed shop — the builder's getCustomDomainSubscription('')
    // short-circuits to inactive, and the webhook only needs shop_id to grant.
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
  return NextResponse.json({ ok: true, url: result.url })
}
