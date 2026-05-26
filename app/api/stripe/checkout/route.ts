import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe, getShopStripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { detectChannel } from '@/lib/channel'

export async function POST(req: NextRequest) {
  // Auth is optional for one-time purchases — Stripe Checkout collects buyer email.
  // Subscriptions (different route) require auth for lifecycle management.
  const { userId } = await auth()

  let body: { listingId: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!body.listingId) {
    return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  }

  // ── Fetch listing + shop ──────────────────────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, images, shop_id, metadata, marketplace_shops!inner(id, name, metadata)')
    .eq('id', body.listingId)
    .eq('status', 'active')
    .single()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  }

  if (!listing.price_cents || listing.price_cents <= 0) {
    return NextResponse.json({ error: 'Este anuncio no tiene precio definido.' }, { status: 422 })
  }

  // ── Check seller has active Stripe account ────────────────────────────────
  const shops = listing.marketplace_shops as unknown as { id: string; name: string; metadata: Record<string, unknown> | null } | { id: string; name: string; metadata: Record<string, unknown> | null }[]
  const shop = Array.isArray(shops) ? shops[0] : shops
  const stripeSettings = getShopStripe(shop?.metadata ?? null)

  if (!stripeSettings.account_id || !stripeSettings.charges_enabled) {
    return NextResponse.json({
      error: 'Este vendedor aún no ha activado los pagos. Contacta al vendedor directamente.',
      code: 'SELLER_NOT_CONNECTED',
    }, { status: 422 })
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`
  const thumb = (listing.images as Array<{ url: string }> | null)?.[0]?.url

  // Physical products need a shipping address collected at checkout
  const isPhysical = listing.listing_type === 'product'

  // ── Create Stripe Checkout Session ────────────────────────────────────────
  // Zero commission: full amount transferred to seller, platform_fee = 0
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: (listing.currency ?? 'MXN').toLowerCase(),
        unit_amount: listing.price_cents,
        product_data: {
          name: listing.title,
          ...(thumb ? { images: [thumb] } : {}),
        },
      },
    }],
    payment_intent_data: {
      // Zero-commission: full amount goes to seller
      transfer_data: { destination: stripeSettings.account_id },
      application_fee_amount: 0,
    },
    // Collect shipping address for physical products
    ...(isPhysical ? {
      shipping_address_collection: {
        allowed_countries: ['MX'],
      },
    } : {}),
    // Collect buyer email for digital delivery
    customer_email: undefined, // Stripe shows email field automatically
    success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/l/${listing.id}?payment=cancelled`,
    metadata: {
      listing_id: listing.id,
      shop_id: listing.shop_id,
      buyer_clerk_id: userId ?? '',
      listing_type: listing.listing_type,
      channel: detectChannel(req),
      is_physical: isPhysical ? 'true' : 'false',
    },
  })

  return NextResponse.json({ url: session.url })
}
