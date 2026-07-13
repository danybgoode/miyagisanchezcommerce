import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe, getShopStripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { detectChannel } from '@/lib/channel'
import { resolveOrigin } from '@/lib/request-origin'

interface CheckoutBody {
  listingId: string
  buyerEmail?: string
  offerId?: string
}

function listingLookupColumn(listingId: string) {
  return listingId.startsWith('prod_') ? 'medusa_product_id' : 'id'
}

export async function POST(req: NextRequest) {
  // Auth is optional for one-time purchases — Stripe Checkout collects buyer email.
  // Subscriptions (different route) require auth for lifecycle management.
  const { userId } = await auth()

  let body: CheckoutBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!body.listingId) {
    return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  }

  // ── Fetch listing + shop ──────────────────────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, images, shop_id, metadata, marketplace_shops!inner(id, name, metadata)')
    .eq(listingLookupColumn(body.listingId), body.listingId)
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

  if (stripeSettings.enabled === false || !stripeSettings.account_id || !stripeSettings.charges_enabled) {
    return NextResponse.json({
      error: 'Este vendedor aún no ha activado los pagos. Contacta al vendedor directamente.',
      code: 'SELLER_NOT_CONNECTED',
    }, { status: 422 })
  }

  let priceCents = listing.price_cents
  if (body.offerId) {
    const { data: offer } = await db
      .from('marketplace_offers')
      .select('offer_amount_cents, counter_amount_cents, status')
      .eq('id', body.offerId)
      .eq('listing_id', listing.id)
      .single()

    if (offer?.status === 'accepted') {
      priceCents = offer.counter_amount_cents ?? offer.offer_amount_cents
    }
  }

  let origin: string
  try {
    origin = resolveOrigin({ siteUrl: process.env.NEXT_PUBLIC_SITE_URL, host: req.headers.get('host') })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar el pago.' }, { status: 500 })
  }
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
        unit_amount: priceCents,
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
      offer_id: body.offerId ?? '',
      channel: detectChannel(req),
      is_physical: isPhysical ? 'true' : 'false',
    },
    ...(body.buyerEmail ? { customer_email: body.buyerEmail } : {}),
  })

  return NextResponse.json({ url: session.url, checkoutUrl: session.url })
}
