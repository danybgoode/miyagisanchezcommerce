import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { sendSaleCompletedToSeller, sendOrderConfirmedToBuyer, getSellerEmail, cancelScheduledEmail } from '@/lib/email'
import { formatOfferAmount } from '@/lib/offers'
import { deliverOrderWebhook } from '@/lib/ucp/webhooks'
import { tg } from '@/lib/telegram'
import { transferToSeller } from '@/lib/stripe-subscriptions'
import { getR2DigitalSignedUrl, isR2DigitalConfigured } from '@/lib/r2'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/** Complete a Medusa cart → creates the Medusa order. Returns the order ID. */
async function completeMedusaCart(cartId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      console.error('[stripe webhook] completeMedusaCart failed:', cartId, body)
      return null
    }
    const data = await res.json().catch(() => ({}))
    const orderId = data?.order?.id ?? null
    console.log('[stripe webhook] Medusa cart completed:', cartId, '→ order:', orderId)
    return orderId
  } catch (e) {
    console.error('[stripe webhook] completeMedusaCart error:', cartId, e)
    return null
  }
}

/** Fetch listing info from Medusa for email context */
async function getMedusaListing(productId: string): Promise<{ title: string; seller_name: string; seller_clerk_id?: string } | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${productId}`, {
      headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY },
    })
    if (!res.ok) return null
    const { listing } = await res.json()
    return {
      title: listing?.title ?? listing?.name ?? 'Producto',
      seller_name: listing?.seller?.name ?? listing?.shop?.name ?? '',
      seller_clerk_id: listing?.seller?.clerk_user_id ?? listing?.shop?.clerk_user_id ?? undefined,
    }
  } catch {
    return null
  }
}

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
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode === 'subscription') {
        await handleSubscriptionCheckoutComplete(session)
      } else {
        await handleCheckoutComplete(session)
      }
      break
    }

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      break

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break

    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
      break

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
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
  const meta = session.metadata ?? {}

  // ── New Medusa-backed flow (cart_id present in metadata) ──────────────────
  if (meta.cart_id) {
    await handleMedusaCheckoutComplete(session)
    return
  }

  // ── Legacy Supabase flow ──────────────────────────────────────────────────
  const { listing_id, shop_id, listing_type, offer_id, buyer_clerk_id, is_physical } = meta
  if (!listing_id || !shop_id) return

  const amountTotal = session.amount_total ?? 0
  const currency = (session.currency ?? 'mxn').toUpperCase()
  const buyerEmail = session.customer_details?.email ?? null
  const buyerName = session.customer_details?.name ?? null
  const isPhysical = is_physical === 'true' || listing_type === 'product'

  // Extract shipping address from Stripe session (present for physical products)
  const stripeShipping = (session as unknown as Record<string, unknown>).shipping_details as
    { name?: string; address?: Record<string, string | null> } | null | undefined
  const shippingAddress: Record<string, string> | null = stripeShipping?.address
    ? {
        name:        stripeShipping.name ?? buyerName ?? '',
        line1:       stripeShipping.address.line1 ?? '',
        line2:       stripeShipping.address.line2 ?? '',
        city:        stripeShipping.address.city ?? '',
        state:       stripeShipping.address.state ?? '',
        postal_code: stripeShipping.address.postal_code ?? '',
        country:     stripeShipping.address.country ?? 'MX',
      }
    : null

  // Physical products start in 'processing' so seller can acknowledge.
  // Digital products go straight to 'paid' (webhook will fulfill them).
  const initialStatus = isPhysical ? 'processing' : 'paid'

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
      buyer_clerk_user_id: buyer_clerk_id || null,
      amount_cents: amountTotal,
      currency,
      status: initialStatus,
      shipping_address: shippingAddress ?? {},
      shipping_method: isPhysical ? 'pending' : 'none',
      metadata: offer_id ? { offer_id } : {},
    })
    .select('id')
    .single()

  if (!order) {
    console.error('Failed to create order record for session:', session.id)
    return
  }

  // ── Fire UCP webhook (non-fatal) ─────────────────────────────────────────
  deliverOrderWebhook(order.id, 'order.created').catch(e => console.error('[ucp-webhook] stripe:', e))

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

  // ── Telegram admin alert ──────────────────────────────────────────────────
  const amountFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amountTotal / 100)
  tg.salePaid(amountFmt, listing.title, buyerEmail ?? 'comprador', 'stripe')

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
    getSellerEmail(shop.clerk_user_id).then(async sellerEmail => {
      if (!sellerEmail) return
      if (isPhysical && order) {
        // Physical order → send richer email with buyer address + order link
        const { sendNewOrderToSeller } = await import('@/lib/email')
        return sendNewOrderToSeller({
          sellerEmail,
          listingTitle: listing.title,
          listingUrl,
          amountPaid: amountFormatted,
          buyerName,
          buyerEmail,
          shippingAddress: shippingAddress ?? null,
          orderId: order.id,
          orderUrl: `${listingUrl.replace(/\/l\/.*/, '')}/shop/manage/orders/${order.id}`,
        })
      }
      return sendSaleCompletedToSeller({
        sellerEmail,
        listingTitle: listing.title,
        listingUrl,
        amountPaid: amountFormatted,
        buyerName,
        buyerEmail,
        isDigital,
      })
    }).catch(e => console.error('[email] sale completed seller:', e))
  }
}

// ── New Medusa flow: checkout.session.completed ───────────────────────────────

async function handleMedusaCheckoutComplete(session: Stripe.Checkout.Session) {
  const { cart_id, product_id, seller_id, offer_id } = session.metadata ?? {}
  if (!cart_id) return

  const amountTotal = session.amount_total ?? 0
  const currency = (session.currency ?? 'mxn').toUpperCase()
  const buyerEmail = session.customer_details?.email ?? null
  const buyerName = session.customer_details?.name ?? null

  // 1. Complete the Medusa cart → creates Medusa order
  const medusaOrderId = await completeMedusaCart(cart_id)

  // 2. Record in Supabase so existing seller/buyer order UIs can find it
  if (medusaOrderId) {
    const { error: insertErr } = await db.from('marketplace_orders').insert({
      shop_id: seller_id ?? '',        // Medusa seller ID — used as shop_id for queries
      listing_id: product_id ?? '',    // Medusa product ID
      stripe_session_id: session.id,
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      amount_cents: amountTotal,
      currency,
      status: 'paid',
      shipping_method: 'pending',
      metadata: {
        medusa_order_id: medusaOrderId,
        medusa_cart_id: cart_id,
        ...(offer_id ? { offer_id } : {}),
      },
    })
    if (insertErr) console.error('[stripe webhook] Supabase order insert failed:', insertErr)
  }

  // 3. Fire UCP webhook (non-fatal)
  deliverOrderWebhook(medusaOrderId ?? cart_id, 'order.created').catch(e => console.error('[ucp-webhook] medusa stripe:', e))

  // 3. Mark winning offer as paid + cancel payment-expiry reminder
  if (offer_id) {
    const { data: paidOffer } = await db
      .from('marketplace_offers')
      .select('scheduled_reminder_ids')
      .eq('id', offer_id)
      .single()

    await db.from('marketplace_offers').update({ status: 'paid' }).eq('id', offer_id)

    const paidReminders = (paidOffer?.scheduled_reminder_ids ?? {}) as Record<string, string>
    if (paidReminders.buyer_payment_expiry) {
      cancelScheduledEmail(paidReminders.buyer_payment_expiry).catch(() => {})
    }

    // Auto-decline competing offers
    await db.from('marketplace_offers')
      .update({ status: 'declined' })
      .eq('listing_id', product_id ?? '')
      .in('status', ['pending', 'countered', 'accepted'])
      .neq('id', offer_id)
  }

  // 4. Telegram admin alert
  const amountFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency }).format(amountTotal / 100)
  tg.salePaid(amountFmt, product_id ?? 'Producto', buyerEmail ?? 'comprador', 'stripe')

  // 5. Fetch Medusa listing for email context (best-effort)
  if (product_id && buyerEmail) {
    const listingInfo = await getMedusaListing(product_id)
    if (listingInfo) {
      const listingUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'}/l/${product_id}`
      const amountFormatted = formatOfferAmount(amountTotal, currency)

      sendOrderConfirmedToBuyer({
        buyerEmail,
        buyerName,
        listingTitle: listingInfo.title,
        listingUrl,
        amountPaid: amountFormatted,
        shopName: listingInfo.seller_name,
        isDigital: false,
        digitalDownloadUrl: null,
        digitalExpiresAt: null,
      }).catch(e => console.error('[email] medusa order confirmed buyer:', e))

      if (listingInfo.seller_clerk_id) {
        getSellerEmail(listingInfo.seller_clerk_id).then(sellerEmail => {
          if (!sellerEmail) return
          return sendSaleCompletedToSeller({
            sellerEmail,
            listingTitle: listingInfo.title,
            listingUrl,
            amountPaid: amountFormatted,
            buyerName,
            buyerEmail,
            isDigital: false,
          })
        }).catch(e => console.error('[email] medusa sale completed seller:', e))
      }
    }
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

  let signedUrl: string | null = null
  if (isR2DigitalConfigured()) {
    try {
      signedUrl = await getR2DigitalSignedUrl(digitalFile.path, EXPIRY, digitalFile.name ?? 'download')
    } catch (e) {
      console.error('[r2-digital] fulfillDigitalOrder signed URL failed:', e)
    }
  } else {
    // Supabase fallback for files uploaded before R2 migration
    const { data: signed } = await db.storage
      .from('digital-files')
      .createSignedUrl(digitalFile.path, EXPIRY, { download: digitalFile.name ?? 'download' })
    signedUrl = signed?.signedUrl ?? null
  }

  if (!signedUrl) {
    console.error('Failed to create signed URL for', digitalFile.path)
    return { downloadUrl: null, expiresAt: null }
  }

  const expiresAt = new Date(Date.now() + EXPIRY * 1000).toISOString()

  await db.from('marketplace_orders').update({
    digital_download_url: signedUrl,
    digital_download_expires_at: expiresAt,
    status: 'fulfilled',
  }).eq('id', orderId)

  return { downloadUrl: signedUrl, expiresAt }
}

// ── account.updated — sync seller Stripe status ───────────────────────────────

async function handleAccountUpdated(account: Stripe.Account) {
  if (!account.id) return

  // Sync Medusa seller metadata (new system)
  try {
    await fetch(`${MEDUSA_BASE}/store/sellers/stripe-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
      body: JSON.stringify({
        stripe_account_id: account.id,
        charges_enabled: account.charges_enabled,
        details_submitted: account.details_submitted,
      }),
    })
  } catch (e) {
    console.error('[stripe webhook] Medusa seller stripe-sync failed:', e)
  }

  // Also sync legacy Supabase shops table (backwards compat during migration)
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

// ── Subscription: checkout.session.completed (mode=subscription) ──────────────

async function handleSubscriptionCheckoutComplete(session: Stripe.Checkout.Session) {
  const { listing_id, shop_id, buyer_clerk_id, tier_id } = session.metadata ?? {}
  if (!listing_id || !shop_id) return

  const stripeSubscriptionId = session.subscription as string | null
  const buyerEmail = session.customer_details?.email ?? null
  const buyerName  = session.customer_details?.name ?? null

  if (!stripeSubscriptionId) {
    console.error('[stripe sub] no subscription ID in session:', session.id)
    return
  }

  // Fetch subscription from Stripe to get period dates
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  // `current_period_*` moved off top-level in newer Stripe API versions — cast to access
  type SubWithPeriod = { current_period_start: number; current_period_end: number; cancel_at_period_end: boolean }
  const _sub = stripeSub as unknown as SubWithPeriod

  const periodStart = new Date(_sub.current_period_start * 1000).toISOString()
  const periodEnd   = new Date(_sub.current_period_end   * 1000).toISOString()

  const { data: existing } = await db
    .from('marketplace_subscriptions')
    .select('id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle()

  if (existing) return // idempotent

  await db.from('marketplace_subscriptions').insert({
    listing_id,
    shop_id,
    buyer_clerk_user_id: buyer_clerk_id || null,
    buyer_email:  buyerEmail?.toLowerCase().trim() ?? '',
    buyer_name:   buyerName ?? null,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: session.customer as string | null,
    payment_method: 'stripe',
    status: 'active',
    current_period_start: periodStart,
    current_period_end:   periodEnd,
    tier_id: tier_id || null,
  })

  // ── Also record in Medusa subscriptions module (best-effort) ─────────────
  // Look up the Medusa SubscriptionPlan by stripe_price_id
  try {
    const stripePriceId = stripeSub.items.data[0]?.price?.id
    if (stripePriceId) {
      // Find matching Medusa plan via the subscription-plans listing endpoint
      const planLookupRes = await fetch(
        `${MEDUSA_BASE}/store/sellers/subscription-plans/by-stripe-price?stripe_price_id=${encodeURIComponent(stripePriceId)}`,
        { headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY } }
      )
      if (planLookupRes.ok) {
        const { plan } = await planLookupRes.json() as { plan?: { id: string; seller_id: string } }
        if (plan?.id) {
          await fetch(`${MEDUSA_BASE}/store/subscriptions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-publishable-api-key': MEDUSA_PUB_KEY,
              'x-internal-secret': process.env.MEDUSA_INTERNAL_SECRET ?? '',
            },
            body: JSON.stringify({
              plan_id: plan.id,
              seller_id: plan.seller_id,
              buyer_email: buyerEmail?.toLowerCase().trim() ?? '',
              clerk_user_id: buyer_clerk_id ?? null,
              status: 'active',
              payment_method: 'stripe',
              stripe_subscription_id: stripeSubscriptionId,
              stripe_customer_id: session.customer as string | null,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              metadata: { listing_id, shop_id, tier_id: tier_id ?? null },
            }),
          }).catch(e => console.error('[stripe sub] Medusa subscription record failed:', e))
        }
      }
    }
  } catch (e) {
    console.error('[stripe sub] Medusa subscription sync error:', e)
  }

  tg.newSubscription(
    `${(stripeSub.items.data[0]?.price.unit_amount ?? 0) / 100} ${stripeSub.currency.toUpperCase()}`,
    'month',
    listing_id,
    buyerEmail ?? 'comprador',
  )
}

// ── customer.subscription.updated ─────────────────────────────────────────────

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  type SubWithPeriod = { current_period_start: number; current_period_end: number }
  const _s = subscription as unknown as SubWithPeriod
  const periodStart = new Date(_s.current_period_start * 1000).toISOString()
  const periodEnd   = new Date(_s.current_period_end   * 1000).toISOString()

  await db.from('marketplace_subscriptions')
    .update({
      status: subscription.status,
      current_period_start: periodStart,
      current_period_end:   periodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)
}

// ── customer.subscription.deleted ─────────────────────────────────────────────

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await db.from('marketplace_subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscription.id)
}

// ── invoice.payment_succeeded ─────────────────────────────────────────────────

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined
  if (!stripeSubscriptionId) return

  // Update billing period on the subscription
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  type SubWithPeriod = { current_period_start: number; current_period_end: number }
  const _sp = stripeSub as unknown as SubWithPeriod
  const periodStart = new Date(_sp.current_period_start * 1000).toISOString()
  const periodEnd   = new Date(_sp.current_period_end   * 1000).toISOString()

  await db.from('marketplace_subscriptions')
    .update({
      status: 'active',
      current_period_start: periodStart,
      current_period_end:   periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', stripeSubscriptionId)

  // ── Transfer 97% to seller's connected account ──────────────────────────
  const amountPaid  = invoice.amount_paid ?? 0
  const currency    = invoice.currency ?? 'mxn'
  const chargeId    = (invoice as unknown as Record<string, unknown>).charge as string | undefined

  // Get the subscription to find the shop/listing
  const { data: sub } = await db
    .from('marketplace_subscriptions')
    .select('listing_id, shop_id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle()

  if (sub && chargeId) {
    // Look up seller's connected Stripe account
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('metadata')
      .eq('id', sub.shop_id)
      .maybeSingle()

    const shopMeta = (shop?.metadata ?? {}) as Record<string, unknown>
    const shopSettings = (shopMeta.settings ?? {}) as Record<string, unknown>
    const stripeSettings = (shopSettings.stripe ?? {}) as Record<string, unknown>
    const connectedAccountId = stripeSettings.account_id as string | undefined

    if (connectedAccountId && amountPaid > 0) {
      await transferToSeller({
        amountCents: amountPaid,
        currency,
        connectedAccountId,
        sourceTransaction: chargeId,
        metadata: { listing_id: sub.listing_id, shop_id: sub.shop_id, stripe_subscription_id: stripeSubscriptionId },
      })
    }
  }
}

// ── invoice.payment_failed ────────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined
  if (!stripeSubscriptionId) return

  await db.from('marketplace_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', stripeSubscriptionId)

  tg.alert(`⚠️ Pago fallido en suscripción Stripe\nSubscription: ${stripeSubscriptionId}`)
}
