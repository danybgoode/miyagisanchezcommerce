import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'
import { canAccept, canCounter, canDecline, formatOfferAmount } from '@/lib/offers'
import { sendOfferDeclined, sendOfferCountered, sendOfferAccepted, sendBuyerCounterExpiryWarning, sendBuyerPaymentExpiryWarning, cancelScheduledEmail } from '@/lib/email'

interface RespondBody {
  action: 'accept' | 'counter' | 'decline'
  counterAmountCents?: number
  counterMessage?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })

  let body: RespondBody
  try {
    body = await req.json() as RespondBody
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { action, counterAmountCents, counterMessage } = body

  // ── Fetch offer + listing + shop (must belong to current seller) ──────────
  const { data: offer } = await db
    .from('marketplace_offers')
    .select(`
      *,
      marketplace_listings!inner(
        id, title, price_cents, currency, listing_type, images, status,
        marketplace_shops!inner(id, clerk_user_id, metadata)
      )
    `)
    .eq('id', id)
    .single()

  if (!offer) return NextResponse.json({ error: 'Oferta no encontrada.' }, { status: 404 })

  const listing = offer.marketplace_listings as unknown as {
    id: string; title: string; price_cents: number; currency: string
    listing_type: string; images: Array<{ url: string }> | null; status: string
    marketplace_shops: { id: string; clerk_user_id: string | null; metadata: Record<string, unknown> | null }
  }

  if (listing.marketplace_shops.clerk_user_id !== user.id) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  const origin = req.headers.get('origin') ?? 'https://miyagisanchez.com'
  async function getConversationUrl() {
    const { data: conv } = await db
      .from('marketplace_conversations')
      .select('id')
      .eq('offer_id', id)
      .maybeSingle()
    return conv?.id ? `${origin}/messages/${conv.id}` : null
  }

  // ── Cancel any pending seller reminder emails ────────────────────────────────
  // Do this before any state change so ghost reminders never fire.
  const scheduledIds = (offer.scheduled_reminder_ids ?? {}) as Record<string, string>
  const cancelSellerReminders = () => {
    if (scheduledIds.seller_24h) cancelScheduledEmail(scheduledIds.seller_24h).catch(() => {})
    if (scheduledIds.seller_expiry) cancelScheduledEmail(scheduledIds.seller_expiry).catch(() => {})
  }

  // ── Validate action against current state ─────────────────────────────────
  if (action === 'accept' && !canAccept(offer)) {
    return NextResponse.json({ error: 'Esta oferta no puede ser aceptada en su estado actual.' }, { status: 409 })
  }
  if (action === 'counter' && !canCounter(offer)) {
    return NextResponse.json({ error: 'Esta oferta no puede recibir contraoferta.' }, { status: 409 })
  }
  if (action === 'decline' && !canDecline(offer)) {
    return NextResponse.json({ error: 'Esta oferta no puede ser rechazada.' }, { status: 409 })
  }

  // ── Conversation event helper ─────────────────────────────────────────────
  async function emitConvEvent(eventType: string, actor: string, metadata: Record<string, unknown>, incBuyerUnread = false) {
    const { data: conv } = await db
      .from('marketplace_conversations')
      .select('id, buyer_unread')
      .eq('offer_id', id)
      .maybeSingle()
    if (!conv) return
    await Promise.all([
      db.from('marketplace_conversation_events').insert({ conversation_id: conv.id, event_type: eventType, actor, metadata }),
      incBuyerUnread
        ? db.from('marketplace_conversations').update({ last_event_at: new Date().toISOString(), updated_at: new Date().toISOString(), buyer_unread: (conv.buyer_unread ?? 0) + 1 }).eq('id', conv.id)
        : db.from('marketplace_conversations').update({ last_event_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', conv.id),
    ])
  }

  // ── Handle: Decline ───────────────────────────────────────────────────────
  if (action === 'decline') {
    cancelSellerReminders()
    await db.from('marketplace_offers').update({ status: 'declined' }).eq('id', id)
    emitConvEvent('offer_declined', 'system', {}, true).catch(e => console.error('[conv] decline event:', e))
    sendOfferDeclined({
      listingTitle: listing.title, listingUrl: `https://miyagisanchez.com/l/${listing.id}`,
      askingPrice: formatOfferAmount(listing.price_cents, listing.currency),
      offerAmount: formatOfferAmount(offer.offer_amount_cents, listing.currency),
      buyerEmail: offer.buyer_email, buyerName: offer.buyer_name,
    }).catch(e => console.error('[email] offer declined:', e))
    return NextResponse.json({ status: 'declined' })
  }

  // ── Handle: Counter ───────────────────────────────────────────────────────
  if (action === 'counter') {
    cancelSellerReminders()
    if (!counterAmountCents || !Number.isInteger(counterAmountCents)) {
      return NextResponse.json({ error: 'Monto de contraoferta inválido.', field: 'counterAmount' }, { status: 422 })
    }
    if (counterAmountCents <= offer.offer_amount_cents) {
      return NextResponse.json({
        error: 'La contraoferta debe ser mayor a la oferta del comprador.',
        field: 'counterAmount',
      }, { status: 422 })
    }
    if (counterAmountCents >= listing.price_cents) {
      return NextResponse.json({
        error: 'La contraoferta debe ser menor al precio de lista.',
        field: 'counterAmount',
      }, { status: 422 })
    }

    const counterExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await db.from('marketplace_offers').update({
      status: 'countered',
      counter_amount_cents: counterAmountCents,
      counter_message: counterMessage?.trim() ?? null,
      counter_expires_at: counterExpiresAt,
    }).eq('id', id)

    const conversationUrl = await getConversationUrl()
    sendOfferCountered({
      listingTitle: listing.title, listingId: listing.id,
      listingUrl: `https://miyagisanchez.com/l/${listing.id}`,
      askingPrice: formatOfferAmount(listing.price_cents, listing.currency),
      offerAmount: formatOfferAmount(offer.offer_amount_cents, listing.currency),
      offerPct: Math.round((offer.offer_amount_cents / listing.price_cents) * 100),
      buyerName: offer.buyer_name, buyerEmail: offer.buyer_email, buyerMessage: offer.message,
      currency: listing.currency, offerId: id,
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      counterAmount: formatOfferAmount(counterAmountCents, listing.currency),
      counterPct: Math.round((counterAmountCents / listing.price_cents) * 100),
      counterMessage: counterMessage ?? null,
      counterExpiresAt,
      conversationUrl,
    }).catch(e => console.error('[email] offer countered:', e))

    // Schedule buyer counter-expiry reminder at counterExpiresAt − 4h
    sendBuyerCounterExpiryWarning({
      buyerEmail: offer.buyer_email,
      listingTitle: listing.title,
      listingUrl: `https://miyagisanchez.com/l/${listing.id}`,
      counterAmount: formatOfferAmount(counterAmountCents, listing.currency),
      expiresAt: counterExpiresAt,
      conversationUrl,
    }, new Date(new Date(counterExpiresAt).getTime() - 4 * 3600 * 1000))
      .then(async counterExpiryId => {
        if (!counterExpiryId) return
        const newIds = { ...scheduledIds, buyer_counter_expiry: counterExpiryId }
        await db.from('marketplace_offers').update({ scheduled_reminder_ids: newIds }).eq('id', id)
      })
      .catch(e => console.error('[reminders] buyer counter expiry:', e))

    emitConvEvent('offer_countered', 'seller', { counter_amount_cents: counterAmountCents, currency: listing.currency, message: counterMessage ?? null }, true).catch(e => console.error('[conv] counter event:', e))
    return NextResponse.json({ status: 'countered' })
  }

  // ── Handle: Accept ────────────────────────────────────────────────────────
  if (action === 'accept') {
    cancelSellerReminders()
    const acceptedCents = offer.offer_amount_cents
    const shopMeta = listing.marketplace_shops.metadata as Record<string, unknown> | null
    const stripeSettings = (shopMeta?.settings as Record<string, unknown> | undefined)?.stripe as
      { enabled?: boolean; account_id?: string; charges_enabled?: boolean } | undefined

    // Try to create Stripe checkout session
    let checkoutSessionId: string | null = null
    let checkoutExpires: string | null = null

    if (stripeSettings?.enabled !== false && stripeSettings?.charges_enabled && stripeSettings?.account_id) {
      try {
        const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: offer.buyer_email,
          expires_at: expiresAt,
          line_items: [{
            price_data: {
              currency: listing.currency.toLowerCase(),
              unit_amount: acceptedCents,
              product_data: {
                name: `${listing.title} (oferta aceptada)`,
                images: listing.images?.[0]?.url ? [listing.images[0].url] : [],
              },
            },
            quantity: 1,
          }],
          payment_intent_data: {
            transfer_data: { destination: stripeSettings.account_id },
            application_fee_amount: 0,
            metadata: {
              listing_id: listing.id,
              shop_id: listing.marketplace_shops.id,
              listing_type: listing.listing_type,
              offer_id: id,
            },
          },
          metadata: {
            listing_id: listing.id,
            shop_id: listing.marketplace_shops.id,
            listing_type: listing.listing_type,
            offer_id: id,
          },
          success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/l/${listing.id}?offer=cancelled`,
        })
        checkoutSessionId = session.id
        checkoutExpires = new Date(expiresAt * 1000).toISOString()
      } catch (err) {
        console.error('Failed to create offer checkout session:', err)
        // Non-fatal — fall through to WhatsApp fallback
      }
    }

    await db.from('marketplace_offers').update({
      status: 'accepted',
      checkout_session_id: checkoutSessionId,
      checkout_expires_at: checkoutExpires,
    }).eq('id', id)

    emitConvEvent('offer_accepted', 'system', { amount_cents: offer.offer_amount_cents, currency: listing.currency }, true).catch(e => console.error('[conv] accept event:', e))
    const conversationUrl = await getConversationUrl()
    sendOfferAccepted({
      listingTitle: listing.title, listingId: listing.id,
      listingUrl: `${origin}/l/${listing.id}`,
      askingPrice: formatOfferAmount(listing.price_cents, listing.currency),
      offerAmount: formatOfferAmount(offer.offer_amount_cents, listing.currency),
      offerPct: Math.round((offer.offer_amount_cents / listing.price_cents) * 100),
      buyerName: offer.buyer_name, buyerEmail: offer.buyer_email,
      currency: listing.currency, offerId: id,
      expiresAt: checkoutExpires ?? new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      checkoutUrl: conversationUrl ?? `${origin}/l/${listing.id}`,
      checkoutExpiresAt: checkoutExpires,
      conversationUrl,
    }).catch(e => console.error('[email] offer accepted:', e))

    // Schedule buyer payment-expiry reminder at checkoutExpires − 4h (Stripe flow only)
    if (checkoutExpires) {
      sendBuyerPaymentExpiryWarning({
        buyerEmail: offer.buyer_email,
        listingTitle: listing.title,
        checkoutUrl: conversationUrl ?? `${origin}/l/${listing.id}`,
        agreedAmount: formatOfferAmount(acceptedCents, listing.currency),
        expiresAt: checkoutExpires,
      }, new Date(new Date(checkoutExpires).getTime() - 4 * 3600 * 1000))
        .then(async paymentExpiryId => {
          if (!paymentExpiryId) return
          const newIds = { ...scheduledIds, buyer_payment_expiry: paymentExpiryId }
          await db.from('marketplace_offers').update({ scheduled_reminder_ids: newIds }).eq('id', id)
        })
        .catch(e => console.error('[reminders] buyer payment expiry:', e))
    }

    return NextResponse.json({ status: 'accepted' })
  }

  return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 })
}
