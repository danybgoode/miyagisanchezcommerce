import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getShopStripe } from '@/lib/stripe'
import { createSubscriptionCheckout } from '@/lib/stripe-subscriptions'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: { listingId: string; tierId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  if (!body.listingId) {
    return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  }

  // ── Fetch listing + shop ──────────────────────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, status, metadata, shop_id, marketplace_shops!inner(id, name, metadata, clerk_user_id)')
    .eq('id', body.listingId)
    .eq('status', 'active')
    .maybeSingle()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado o no disponible.' }, { status: 404 })
  }
  if (listing.listing_type !== 'subscription') {
    return NextResponse.json({ error: 'Este anuncio no es una suscripción.' }, { status: 422 })
  }

  const meta = (listing.metadata ?? {}) as Record<string, unknown>

  // ── Resolve Stripe price ID from tier or single-plan metadata ─────────────
  type StoredTier = { id: string; stripe_price_id?: string }
  const tiers = meta.subscription_tiers as StoredTier[] | undefined
  let priceId: string | undefined
  let resolvedTierId: string | undefined

  if (tiers && tiers.length > 0) {
    const tier = body.tierId ? tiers.find(t => t.id === body.tierId) : tiers[0]
    if (!tier) return NextResponse.json({ error: 'Plan no encontrado.' }, { status: 404 })
    priceId = tier.stripe_price_id
    resolvedTierId = tier.id
  } else {
    const subMeta = (meta.subscription ?? {}) as Record<string, unknown>
    priceId = subMeta.stripe_price_id as string | undefined
  }

  if (!priceId) {
    return NextResponse.json({ error: 'Este anuncio no tiene Stripe configurado aún.' }, { status: 422 })
  }

  // ── Optional: get current user email ─────────────────────────────────────
  const clerkUser = await currentUser()
  const buyerEmail = clerkUser?.emailAddresses?.[0]?.emailAddress

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`

  const url = await createSubscriptionCheckout({
    priceId,
    successUrl: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
    cancelUrl: `${origin}/l/${listing.id}?payment=cancelled`,
    buyerEmail,
    metadata: {
      listing_id: listing.id,
      shop_id: listing.shop_id,
      listing_type: 'subscription',
      buyer_clerk_id: clerkUser?.id ?? '',
      ...(resolvedTierId ? { tier_id: resolvedTierId } : {}),
    },
  })

  return NextResponse.json({ url })
}
