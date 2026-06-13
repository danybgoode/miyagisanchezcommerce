/**
 * POST /api/sell/shop/domain/subscribe
 *
 * Start a Stripe checkout for the custom-domain subscription SKU (epic 07 ·
 * custom-domain-paywall). The PLATFORM is the payee (no connected account, no
 * 97% transfer). On payment the webhook activates a Medusa Subscription
 * (subscriber = seller), which flips the Sprint-1 entitlement seam on.
 *
 * Sprint 3: accepts an optional `{ coupon }` in the body — the campaign coupon
 * `miyagisan` comps the first year (capped at 100; the 101st is refused with a
 * clear message). The shared `startCustomDomainCheckout` builder owns the plan
 * lookup + coupon resolution so the agent (MCP) path can't drift.
 *
 * Auth required (seller session). Returns `{ url }` to redirect to Stripe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { detectChannel } from '@/lib/channel'
import { startCustomDomainCheckout } from '@/lib/domain-subscription-checkout'

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Debes iniciar sesión.', code: 'AUTH_REQUIRED' },
      { status: 401 },
    )
  }

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  // Optional coupon code from the body (campaign coupon `miyagisan`).
  let couponCode: string | null = null
  try {
    const body = (await req.json()) as { coupon?: unknown }
    if (typeof body?.coupon === 'string') couponCode = body.coupon
  } catch {
    // No / empty body — straight (paid) checkout.
  }

  // The seller's first shop (same lookup the domain route uses).
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop) {
    return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  }

  const result = await startCustomDomainCheckout({
    shopId: shop.id,
    sellerClerkId: user.id,
    buyerEmail: user.emailAddresses?.[0]?.emailAddress,
    channel: detectChannel(req),
    couponCode,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.alreadyActive ? { alreadyActive: true } : {}) },
      { status: result.status },
    )
  }

  return NextResponse.json({ url: result.url })
}
