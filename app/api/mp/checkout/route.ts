import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createMpPreference } from '@/lib/mercadopago'
import { detectChannel } from '@/lib/channel'

interface CheckoutBody {
  listingId: string
  buyerEmail?: string
  offerId?: string
}

export async function POST(req: NextRequest) {
  let body: CheckoutBody
  try {
    body = await req.json() as CheckoutBody
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { listingId, offerId } = body

  if (!listingId || typeof listingId !== 'string') {
    return NextResponse.json({ error: 'Anuncio no especificado.' }, { status: 400 })
  }

  // Prefer Clerk email; fall back to body-supplied email (anonymous buyers)
  const clerkUser = await currentUser()
  const buyerEmail = clerkUser?.emailAddresses[0]?.emailAddress ?? body.buyerEmail

  // ── Fetch listing + shop ──────────────────────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, status, marketplace_shops!inner(id, mp_enabled)')
    .eq('id', listingId)
    .single()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  }
  if (listing.status !== 'active') {
    return NextResponse.json({ error: 'Este anuncio ya no está disponible.' }, { status: 409 })
  }

  const shop = listing.marketplace_shops as unknown as { id: string; mp_enabled: boolean | null }
  if (shop.mp_enabled === false) {
    return NextResponse.json({ error: 'Este vendedor no acepta pagos con Mercado Pago.' }, { status: 422 })
  }

  if (listing.listing_type === 'digital') {
    // Digital delivery is handled by the Stripe webhook — keep those on Stripe
    return NextResponse.json({ error: 'Los productos digitales se pagan con tarjeta.' }, { status: 422 })
  }
  if (!listing.price_cents) {
    return NextResponse.json({ error: 'Este anuncio no tiene precio definido.' }, { status: 422 })
  }

  // ── If offer-based purchase, use the accepted offer amount ────────────────
  let priceCents = listing.price_cents
  if (offerId) {
    const { data: offer } = await db
      .from('marketplace_offers')
      .select('offer_amount_cents, counter_amount_cents, status')
      .eq('id', offerId)
      .single()

    if (offer?.status === 'accepted') {
      // counter_amount_cents is set when seller countered; otherwise use offer amount
      priceCents = offer.counter_amount_cents ?? offer.offer_amount_cents
    }
  }

  const origin = req.headers.get('origin') ?? 'https://miyagisanchez.com'
  const isDev = process.env.NODE_ENV === 'development'

  const preference = await createMpPreference({
    title: listing.title,
    priceCents,
    currency: listing.currency,
    buyerEmail,
    listingId: listing.id,
    shopId: shop.id,
    listingType: listing.listing_type,
    offerId,
    origin,
    channel: detectChannel(req),
  })

  return NextResponse.json({
    preferenceId: preference.id,
    // In development use sandbox; in production use the live checkout
    checkoutUrl: isDev ? preference.sandboxInitPoint : preference.initPoint,
  })
}
