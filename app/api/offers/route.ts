import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { validateOfferAmount, formatOfferAmount } from '@/lib/offers'
import { sendOfferConfirmed, sendNewOfferToSeller, sendSellerOfferReminder, sendSellerExpiryWarning, getSellerEmail } from '@/lib/email'
import { computeTrustScore, levelToMinScore, type TrustLevel } from '@/lib/ucp/identity'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { tg } from '@/lib/telegram'

interface CreateOfferBody {
  listingId: string
  buyerName?: string
  buyerEmail?: string
  offerAmountCents: number
  message?: string
}

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

async function resolveListingMirrorId(listingId: string): Promise<string | null> {
  const { data: byMedusa } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('medusa_product_id', listingId)
    .maybeSingle()
  if (byMedusa?.id) return byMedusa.id

  if (!isUuid(listingId)) return null
  const { data: byId } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('id', listingId)
    .maybeSingle()
  return byId?.id ?? null
}

// ── GET — fetch active offer for a buyer+listing ──────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const listingId = searchParams.get('listingId')

  if (!listingId) return NextResponse.json({ offer: null })

  const user = await currentUser()
  if (!user) return NextResponse.json({ offer: null })
  const mirrorListingId = await resolveListingMirrorId(listingId)
  if (!mirrorListingId) return NextResponse.json({ offer: null })

  const { data } = await db
    .from('marketplace_offers')
    .select('*')
    .eq('listing_id', mirrorListingId)
    .eq('buyer_clerk_user_id', user.id)
    .in('status', ['pending', 'countered', 'accepted', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Also look up the conversation for this buyer+listing
  let conversationId: string | null = null
  if (user) {
    const { data: conv } = await db
      .from('marketplace_conversations')
      .select('id')
      .eq('listing_id', mirrorListingId)
      .eq('buyer_clerk_user_id', user.id)
      .maybeSingle()
    conversationId = conv?.id ?? null
  }

  return NextResponse.json({ offer: data ?? null, conversationId })
}

// ── POST — create a new offer ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rl = await checkRateLimit('offers', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas ofertas. Espera un momento e inténtalo de nuevo.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: CreateOfferBody
  try {
    body = await req.json() as CreateOfferBody
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { listingId, offerAmountCents, message } = body

  // ── Require authenticated buyer for offers ────────────────────────────────
  const clerkUser = await currentUser()
  if (!clerkUser) {
    return NextResponse.json({ error: 'Necesitas una cuenta para hacer ofertas.', requiresAuth: true }, { status: 401 })
  }
  const buyerClerkId = clerkUser.id
  const buyerEmail   = clerkUser.emailAddresses[0]?.emailAddress ?? ''
  const buyerName    = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'Comprador'

  // ── Input validation ──────────────────────────────────────────────────────
  if (!listingId || typeof listingId !== 'string') {
    return NextResponse.json({ error: 'Anuncio no especificado.' }, { status: 400 })
  }
  if (!Number.isInteger(offerAmountCents) || offerAmountCents <= 0) {
    return NextResponse.json({ error: 'Monto inválido.', field: 'amount' }, { status: 422 })
  }

  // ── Fetch listing ─────────────────────────────────────────────────────────
  let { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, status, images, marketplace_shops!inner(id, name, metadata, clerk_user_id)')
    .eq('medusa_product_id', listingId)
    .maybeSingle()

  if (!listing && isUuid(listingId)) {
    const fallback = await db
      .from('marketplace_listings')
      .select('id, title, price_cents, currency, listing_type, status, images, marketplace_shops!inner(id, name, metadata, clerk_user_id)')
      .eq('id', listingId)
      .maybeSingle()
    listing = fallback.data
  }

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  }
  const mirrorListingId = listing.id
  if (listing.status !== 'active') {
    return NextResponse.json({ error: 'Este anuncio ya no está disponible.' }, { status: 409 })
  }
  if (listing.listing_type === 'digital') {
    return NextResponse.json({ error: 'Los productos digitales tienen precio fijo.' }, { status: 422 })
  }
  if (!listing.price_cents) {
    return NextResponse.json({ error: 'Este anuncio no tiene precio definido.' }, { status: 422 })
  }

  // ── Amount validation ─────────────────────────────────────────────────────
  const validation = validateOfferAmount(offerAmountCents, listing.price_cents)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message, field: 'amount' }, { status: 422 })
  }

  // ── Trust gate — check min_buyer_trust_level ──────────────────────────────
  const shopMeta = (listing.marketplace_shops as unknown as { metadata: Record<string, unknown> | null }).metadata
  const shopSettings = (shopMeta?.settings ?? {}) as Record<string, unknown>
  const offerSettings = (shopSettings.offers ?? {}) as Record<string, unknown>
  const minTrustLevel = (offerSettings.min_buyer_trust_level as TrustLevel | undefined) ?? 'unverified'

  if (minTrustLevel !== 'unverified') {
    const identifier = buyerClerkId ?? buyerEmail
    const trust = await computeTrustScore(identifier, { skipClerk: !buyerClerkId })
    const minScore = levelToMinScore(minTrustLevel)
    if (trust.score < minScore) {
      return NextResponse.json({
        error: `Este vendedor requiere un nivel de reputación mínimo (${minTrustLevel}) para enviar ofertas. Tu nivel actual es ${trust.level}.`,
        trust_required: minTrustLevel,
        trust_current: trust.level,
        trust_score: trust.score,
      }, { status: 403 })
    }
  }

  // ── Check for existing active offer ──────────────────────────────────────
  const { data: existing } = await db
    .from('marketplace_offers')
    .select('id, status')
    .eq('listing_id', mirrorListingId)
    .ilike('buyer_email', buyerEmail)
    .in('status', ['pending', 'countered'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      error: 'Ya tienes una oferta activa en este anuncio.',
      existingOfferId: existing.id,
    }, { status: 409 })
  }

  // ── Insert offer ──────────────────────────────────────────────────────────
  const { data: offer, error: insertError } = await db
    .from('marketplace_offers')
    .insert({
      listing_id: mirrorListingId,
      shop_id: (listing.marketplace_shops as unknown as { id: string }).id,
      buyer_clerk_user_id: buyerClerkId,
      buyer_email: buyerEmail.toLowerCase().trim(),
      buyer_name: buyerName.trim(),
      offer_amount_cents: offerAmountCents,
      message: message?.trim() ?? null,
    })
    .select('id')
    .single()

  if (insertError || !offer) {
    console.error('Offer insert error:', insertError)
    return NextResponse.json({ error: 'No se pudo enviar la oferta.' }, { status: 500 })
  }

  // ── Create conversation + opening event ───────────────────────────────────
  const shopRow = listing.marketplace_shops as unknown as { id: string; clerk_user_id: string | null }
  let conversationId: string | null = null

  if (shopRow.clerk_user_id) {
    const { data: conv } = await db
      .from('marketplace_conversations')
      .upsert({
        listing_id: mirrorListingId,
        shop_id: shopRow.id,
        buyer_clerk_user_id: buyerClerkId,
        seller_clerk_user_id: shopRow.clerk_user_id,
        offer_id: offer.id,
        seller_unread: 1,
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'buyer_clerk_user_id,listing_id' })
      .select('id')
      .single()

    if (conv) {
      conversationId = conv.id
      await db.from('marketplace_conversation_events').insert({
        conversation_id: conv.id,
        event_type: 'offer_sent',
        actor: 'buyer',
        metadata: { offer_id: offer.id, amount_cents: offerAmountCents, currency: listing.currency },
      })
    }
  }

  // ── A2A auto-negotiation ──────────────────────────────────────────────────
  const negoSettings = (offerSettings.negotiation ?? {}) as {
    enabled?: boolean
    auto_accept_pct?: number
    auto_decline_pct?: number
    auto_counter_pct?: number
  }
  const negoEnabled  = negoSettings.enabled === true
  const offerPct     = Math.round((offerAmountCents / listing.price_cents!) * 100)
  let autoStatus: 'pending' | 'accepted' | 'declined' | 'countered' = 'pending'
  let counterAmountCents: number | null = null

  if (negoEnabled) {
    const acceptPct  = negoSettings.auto_accept_pct  ?? 95
    const declinePct = negoSettings.auto_decline_pct ?? 60
    const counterPct = negoSettings.auto_counter_pct ?? 80

    if (offerPct >= acceptPct) {
      autoStatus = 'accepted'
    } else if (offerPct < declinePct) {
      autoStatus = 'declined'
    } else if (offerPct < counterPct) {
      // Counter at midpoint between offer and asking price
      const midPct = Math.round((offerPct + 100) / 2)
      counterAmountCents = Math.round(listing.price_cents! * midPct / 100)
      autoStatus = 'countered'
    }
    // If between counterPct and acceptPct: leave as pending (needs manual review)
  }

  if (autoStatus !== 'pending') {
    const updatePayload: Record<string, unknown> = { status: autoStatus }
    if (autoStatus === 'countered' && counterAmountCents !== null) {
      updatePayload.counter_amount_cents = counterAmountCents
    }
    await db.from('marketplace_offers')
      .update(updatePayload)
      .eq('id', offer.id)
  }

  // ── Fire emails (non-fatal) ───────────────────────────────────────────────
  const emailCtx = {
    listingTitle: listing.title,
    listingId,
    listingUrl: `https://miyagisanchez.com/l/${listingId}`,
    askingPrice: formatOfferAmount(listing.price_cents!, listing.currency),
    offerAmount: formatOfferAmount(offerAmountCents, listing.currency),
    offerPct,
    buyerName: buyerName.trim(),
    buyerEmail: buyerEmail.trim().toLowerCase(),
    buyerMessage: message?.trim() ?? null,
    currency: listing.currency,
    offerId: offer.id,
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  }

  // Telegram admin alert
  tg.offerMade(emailCtx.offerAmount, emailCtx.askingPrice ?? '', emailCtx.listingTitle, buyerEmail)

  // Buyer confirmation
  sendOfferConfirmed(emailCtx).catch(e => console.error('[email] offer confirmed:', e))

  // Seller alert + schedule reminders (look up email via Clerk)
  if (shopRow.clerk_user_id) {
    getSellerEmail(shopRow.clerk_user_id).then(async sellerEmail => {
      if (!sellerEmail) return

      // Immediate: new offer notification
      await sendNewOfferToSeller({ ...emailCtx, sellerEmail })

      // Schedule: seller_24h — fires 24h after offer creation
      const reminderCtx = {
        sellerEmail,
        listingTitle: emailCtx.listingTitle,
        listingUrl: emailCtx.listingUrl,
        offerAmount: emailCtx.offerAmount,
        offerPct: emailCtx.offerPct,
        buyerName: emailCtx.buyerName,
        expiresAt: emailCtx.expiresAt,
      }
      const expiresAt = new Date(emailCtx.expiresAt)
      const [seller24hId, sellerExpiryId] = await Promise.all([
        sendSellerOfferReminder(reminderCtx, new Date(Date.now() + 24 * 3600 * 1000)),
        sendSellerExpiryWarning(reminderCtx, new Date(expiresAt.getTime() - 4 * 3600 * 1000)),
      ])

      // Persist IDs so respond routes can cancel them
      const ids: Record<string, string> = {}
      if (seller24hId) ids.seller_24h = seller24hId
      if (sellerExpiryId) ids.seller_expiry = sellerExpiryId
      if (Object.keys(ids).length > 0) {
        await db.from('marketplace_offers')
          .update({ scheduled_reminder_ids: ids })
          .eq('id', offer.id)
      }
    }).catch(e => console.error('[email] seller alert + reminders:', e))
  }

  const responsePayload: Record<string, unknown> = {
    offerId: offer.id,
    status: autoStatus,
    conversationId,
  }
  if (autoStatus === 'countered' && counterAmountCents !== null) {
    responsePayload.counter_amount_cents = counterAmountCents
    responsePayload.counter_amount = formatOfferAmount(counterAmountCents, listing.currency)
  }
  return NextResponse.json(responsePayload, { status: 201 })
}
