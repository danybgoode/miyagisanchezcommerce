/**
 * POST /api/sell/shop/subdomain/subscribe
 *
 * Start a Stripe checkout for the subdomain subscription SKU (epic 07 ·
 * subdomain-pricing, Sprint 2). A faithful clone of the custom-domain subscribe
 * route. The PLATFORM is the payee (no connected account, no 97% transfer). On
 * payment the webhook activates a Medusa Subscription (subscriber = seller) or
 * writes a one-time grant, which flips the Sprint-1 subdomain entitlement seam on
 * (white-label instead of 301→/s/slug).
 *
 * No campaign coupon (that's the custom-domain SKU); accepts an optional cadence
 * (`recurring` default | `one_time`) + promoter code (`PRM-…`, one-time discount).
 * The shared `startSubdomainCheckout` builder owns the plan lookup so the agent
 * (MCP) path can't drift.
 *
 * Auth required (seller session) — checked BEFORE any plan/secret resolution.
 * Returns `{ url }` to redirect to Stripe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { detectChannel } from '@/lib/channel'
import { startSubdomainCheckout } from '@/lib/subdomain-subscription-checkout'

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

  // Optional body: the payment cadence (`recurring` default | `one_time`), the
  // recurring billing interval (`year` default | `month`, Sprint 3), and the
  // promoter code (`PRM-…`, one-time real discount). A missing/empty body =
  // recurring yearly, no discount (back-compat).
  let cadence: string | null = null
  let interval: string | null = null
  let promoterCode: string | null = null
  try {
    const body = (await req.json()) as { cadence?: unknown; interval?: unknown; promoterCode?: unknown }
    if (typeof body?.cadence === 'string') cadence = body.cadence
    if (typeof body?.interval === 'string') interval = body.interval
    if (typeof body?.promoterCode === 'string') promoterCode = body.promoterCode
  } catch {
    // No / empty body — straight (paid) recurring yearly checkout.
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

  const result = await startSubdomainCheckout({
    shopId: shop.id,
    sellerClerkId: user.id,
    buyerEmail: user.emailAddresses?.[0]?.emailAddress,
    channel: detectChannel(req),
    cadence,
    interval,
    promoterCode,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.alreadyActive ? { alreadyActive: true } : {}) },
      { status: result.status },
    )
  }

  return NextResponse.json({ url: result.url })
}
