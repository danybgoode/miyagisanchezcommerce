import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { sendSaleCompletedToSeller, sendOrderConfirmedToBuyer, getSellerEmail, cancelScheduledEmail } from '@/lib/email'
import { formatOfferAmount } from '@/lib/offers'

// In Next.js App Router, req.text() reads the raw body before any parsing —
// no need for bodyParser: false config (that was Pages Router only)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── Handle events ─────────────────────────────────────────────────────────
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      break

    case 'account.updated':
      await handleAccountUpdated(event.data.object as Stripe.Account)
      break

    default:
      // Acknowledge but don't process
      break
  }

  return NextResponse.json({ received: true })
}

// ── checkout.session.completed ────────────────────────────────────────────────

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const { listing_id, shop_id, listing_type, offer_id } = session.metadata ?? {}
  if (!listing_id || !shop_id) return

  const amountTotal = session.amount_total ?? 0
  const currency = (session.currency ?? 'mxn').toUpperCase()
  const buyerEmail = session.customer_details?.email ?? null
  const buyerName = session.customer_details?.name ?? null

  // ── Record the order in Supabase ─────────────────────────────────────────
  const { data: order } = await db
    .from('marketplace_orders')
    .insert({
      listing_id,
      shop_id,
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent as string | null,
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      amount_cents: amountTotal,
      currency,
      status: 'paid',
      metadata: offer_id ? { offer_id } : {},
    })
    .select('id')
    .single()

  if (!order) {
    console.error('Failed to create order record for session:', session.id)
    return
  }

  // ── If this was an offer checkout, mark the offer as paid ────────────────
  if (offer_id) {
    const { data: paidOffer } = await db
      .from('marketplace_offers')
      .select('scheduled_reminder_ids')
      .eq('id', offer_id)
      .single()

    await db.from('marketplace_offers').update({ status: 'paid' }).eq('id', offer_id)

    // Cancel the buyer payment-expiry reminder — payment is done
    const paidReminders = (paidOffer?.scheduled_reminder_ids ?? {}) as Record<string, string>
    if (paidReminders.buyer_payment_expiry) {
      cancelScheduledEmail(paidReminders.buyer_payment_expiry).catch(() => {})
    }
  }

  // ── Auto-decline all OTHER pending/accepted offers for this listing ───────
  // (listing is now sold — clean up competing offers)
  await db.from('marketplace_offers')
    .update({ status: 'declined' })
    .eq('listing_id', listing_id)
    .in('status', ['pending', 'countered', 'accepted'])
    .neq('id', offer_id ?? '')  // don't re-decline the winning offer

  // ── Fetch listing + shop for email context ────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, currency, metadata, marketplace_shops!inner(name, clerk_user_id)')
    .eq('id', listing_id)
    .single()

  if (!listing) return

  const shop = listing.marketplace_shops as unknown as { name: string; clerk_user_id: string | null }
  const listingCurrency = listing.currency ?? currency
  const amountFormatted = formatOfferAmount(amountTotal, listingCurrency)
  const listingUrl = `https://miyagisanchez.com/l/${listing_id}`
  const isDigital = listing_type === 'digital'

  // ── Digital goods: generate signed URL + update order ────────────────────
  let digitalDownloadUrl: string | null = null
  let digitalExpiresAt: string | null = null

  if (isDigital) {
    const result = await fulfillDigitalOrder({ listing, orderId: order.id })
    digitalDownloadUrl = result.downloadUrl
    digitalExpiresAt = result.expiresAt
  }

  // ── Buyer email ───────────────────────────────────────────────────────────
  if (buyerEmail) {
    sendOrderConfirmedToBuyer({
      buyerEmail,
      buyerName,
      listingTitle: listing.title,
      listingUrl,
      amountPaid: amountFormatted,
      shopName: shop.name,
      isDigital,
      digitalDownloadUrl,
      digitalExpiresAt,
    }).catch(e => console.error('[email] order confirmed buyer:', e))
  }

  // ── Seller email ──────────────────────────────────────────────────────────
  if (shop.clerk_user_id) {
    getSellerEmail(shop.clerk_user_id).then(sellerEmail => {
      if (sellerEmail) {
        return sendSaleCompletedToSeller({
          sellerEmail,
          listingTitle: listing.title,
          listingUrl,
          amountPaid: amountFormatted,
          buyerName,
          buyerEmail,
          isDigital,
        })
      }
    }).catch(e => console.error('[email] sale completed seller:', e))
  }
}

// ── Digital fulfillment — signs storage URL and marks order fulfilled ─────────
// Returns the download URL + expiry so the caller can include it in emails.

async function fulfillDigitalOrder({
  listing,
  orderId,
}: {
  listing: { id: string; metadata: unknown }
  orderId: string
}): Promise<{ downloadUrl: string | null; expiresAt: string | null }> {
  const meta = listing.metadata as Record<string, unknown> | null
  const digitalFile = meta?.digital_file as { path?: string; name?: string } | undefined

  if (!digitalFile?.path) {
    console.warn('No digital_file.path for listing', listing.id)
    return { downloadUrl: null, expiresAt: null }
  }

  const EXPIRY = 48 * 60 * 60 // seconds
  const { data: signed } = await db.storage
    .from('digital-files')
    .createSignedUrl(digitalFile.path, EXPIRY, { download: digitalFile.name ?? 'download' })

  if (!signed?.signedUrl) {
    console.error('Failed to create signed URL for', digitalFile.path)
    return { downloadUrl: null, expiresAt: null }
  }

  const expiresAt = new Date(Date.now() + EXPIRY * 1000).toISOString()

  await db.from('marketplace_orders').update({
    digital_download_url: signed.signedUrl,
    digital_download_expires_at: expiresAt,
    status: 'fulfilled',
  }).eq('id', orderId)

  return { downloadUrl: signed.signedUrl, expiresAt }
}

// ── account.updated — sync seller Stripe status ───────────────────────────────

async function handleAccountUpdated(account: Stripe.Account) {
  if (!account.id) return

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .filter('metadata->settings->stripe->>account_id', 'eq', account.id)
    .maybeSingle()

  if (!shop) return

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const existingStripe = (settings.stripe ?? {}) as Record<string, unknown>

  await db.from('marketplace_shops').update({
    metadata: {
      ...meta,
      settings: {
        ...settings,
        stripe: {
          ...existingStripe,
          charges_enabled: account.charges_enabled,
          details_submitted: account.details_submitted,
          onboarding_complete: account.charges_enabled && account.details_submitted,
        },
      },
    },
  }).eq('id', shop.id)
}
