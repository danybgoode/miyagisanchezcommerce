/**
 * POST /api/sell/shop/domain/subscribe
 *
 * Start a Stripe checkout for the custom-domain subscription SKU (epic 07 ·
 * custom-domain-paywall, Sprint 2). The PLATFORM is the payee (no connected
 * account, no 97% transfer) — `createSubscriptionCheckout` runs on the platform
 * Stripe account. On payment the webhook activates a Medusa Subscription
 * (subscriber = seller), which flips the Sprint-1 entitlement seam on.
 *
 * Auth required (seller session). Returns `{ url }` to redirect to Stripe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createSubscriptionCheckout } from '@/lib/stripe-subscriptions'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { detectChannel } from '@/lib/channel'
import {
  getCustomDomainSubscription,
  CUSTOM_DOMAIN_CHECKOUT_KIND,
} from '@/lib/domain-subscription'

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

  // Resolve the platform plan (price id) + short-circuit if already subscribed.
  const sub = await getCustomDomainSubscription(user.id)
  if (sub.active) {
    return NextResponse.json(
      { error: 'Ya tienes una suscripción activa al dominio propio.', alreadyActive: true },
      { status: 409 },
    )
  }
  if (!sub.stripe_price_id) {
    return NextResponse.json(
      { error: 'El plan de dominio propio aún no está disponible. Intenta más tarde.' },
      { status: 422 },
    )
  }

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`

  const url = await createSubscriptionCheckout({
    priceId: sub.stripe_price_id,
    successUrl: `${origin}/shop/manage/settings/canal?domain=activated`,
    cancelUrl: `${origin}/shop/manage/settings/canal?domain=cancelled`,
    buyerEmail,
    metadata: {
      kind: CUSTOM_DOMAIN_CHECKOUT_KIND,
      shop_id: shop.id,
      seller_clerk_id: user.id,
      channel: detectChannel(req),
    },
  })

  return NextResponse.json({ url })
}
