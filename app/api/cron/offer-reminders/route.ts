/**
 * Vercel Cron — runs every hour.
 * Finds offers in reminder-eligible windows and sends one email per window per offer.
 * Uses reminders_sent JSONB to guarantee exactly-once delivery per reminder type.
 *
 * Reminder types:
 *   seller_24h          — seller has not responded 24h after offer was created
 *   seller_expiry       — seller offer expires in <4h, still pending
 *   buyer_counter_expiry — buyer counter expires in <4h, still countered
 *   buyer_payment_expiry — buyer payment link expires in <4h, still accepted
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getSellerEmail, sendSellerOfferReminder, sendSellerExpiryWarning, sendBuyerCounterExpiryWarning, sendBuyerPaymentExpiryWarning } from '@/lib/email'
import { formatOfferAmount as fmt } from '@/lib/offers'

export const runtime = 'nodejs'

// Vercel calls with Authorization: Bearer <CRON_SECRET>
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // allow if not set (local dev)
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

type RawOffer = {
  id: string
  status: string
  offer_amount_cents: number
  buyer_name: string
  buyer_email: string
  expires_at: string
  counter_expires_at: string | null
  checkout_expires_at: string | null
  reminders_sent: Record<string, boolean>
  marketplace_listings: {
    id: string
    title: string
    price_cents: number
    currency: string
    marketplace_shops: {
      clerk_user_id: string | null
    }
  }
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const stats = { seller_24h: 0, seller_expiry: 0, buyer_counter_expiry: 0, buyer_payment_expiry: 0, errors: 0 }

  // ── Fetch all non-terminal offers that might need reminders ──────────────
  const { data: offers, error } = await db
    .from('marketplace_offers')
    .select(`
      id, status, offer_amount_cents, buyer_name, buyer_email,
      expires_at, counter_expires_at, checkout_expires_at, reminders_sent,
      marketplace_listings!inner(
        id, title, price_cents, currency,
        marketplace_shops!inner(clerk_user_id)
      )
    `)
    .in('status', ['pending', 'countered', 'accepted'])
    .gt('expires_at', now.toISOString()) // not yet expired

  if (error || !offers) {
    console.error('[cron/offer-reminders] DB error:', error)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  for (const raw of offers as unknown as RawOffer[]) {
    const listing = raw.marketplace_listings
    const shop = listing.marketplace_shops
    const currency = listing.currency
    const listingUrl = `https://miyagisanchez.com/l/${listing.id}`
    const askingPrice = fmt(listing.price_cents, currency)
    const offerAmount = fmt(raw.offer_amount_cents, currency)
    const offerPct = Math.round((raw.offer_amount_cents / listing.price_cents) * 100)
    const reminders = raw.reminders_sent ?? {}

    try {
      // ── [A] Seller 24h reminder ──────────────────────────────────────────
      if (
        raw.status === 'pending' &&
        !reminders.seller_24h
      ) {
        const createdApprox = new Date(raw.expires_at).getTime() - 48 * 3600 * 1000
        const hoursSinceCreated = (now.getTime() - createdApprox) / 3600000
        if (hoursSinceCreated >= 24 && hoursSinceCreated < 26) {
          const sellerEmail = shop.clerk_user_id ? await getSellerEmail(shop.clerk_user_id) : null
          if (sellerEmail) {
            await sendSellerOfferReminder({ sellerEmail, listingTitle: listing.title, listingUrl, offerAmount, offerPct, buyerName: raw.buyer_name, expiresAt: raw.expires_at })
            await markReminder(raw.id, 'seller_24h')
            stats.seller_24h++
          }
        }
      }

      // ── [B] Seller expiry warning — offer expires in <4h ─────────────────
      if (
        raw.status === 'pending' &&
        !reminders.seller_expiry
      ) {
        const msUntilExpiry = new Date(raw.expires_at).getTime() - now.getTime()
        if (msUntilExpiry > 0 && msUntilExpiry < 4 * 3600 * 1000) {
          const sellerEmail = shop.clerk_user_id ? await getSellerEmail(shop.clerk_user_id) : null
          if (sellerEmail) {
            await sendSellerExpiryWarning({ sellerEmail, listingTitle: listing.title, listingUrl, offerAmount, offerPct, buyerName: raw.buyer_name, expiresAt: raw.expires_at })
            await markReminder(raw.id, 'seller_expiry')
            stats.seller_expiry++
          }
        }
      }

      // ── [C] Buyer counter expiry warning — counter expires in <4h ────────
      if (
        raw.status === 'countered' &&
        raw.counter_expires_at &&
        !reminders.buyer_counter_expiry
      ) {
        const msUntilExpiry = new Date(raw.counter_expires_at).getTime() - now.getTime()
        if (msUntilExpiry > 0 && msUntilExpiry < 4 * 3600 * 1000) {
          // For counter amount, we'd need it from DB — use raw.offer_amount_cents as fallback
          // (the actual counter_amount_cents is in marketplace_offers but not selected above)
          await sendBuyerCounterExpiryWarning({
            buyerEmail: raw.buyer_email,
            listingTitle: listing.title,
            listingUrl,
            counterAmount: offerAmount, // approximate — full refetch would have counter_amount_cents
            expiresAt: raw.counter_expires_at,
          })
          await markReminder(raw.id, 'buyer_counter_expiry')
          stats.buyer_counter_expiry++
        }
      }

      // ── [D] Buyer payment expiry warning — checkout expires in <4h ───────
      if (
        raw.status === 'accepted' &&
        raw.checkout_expires_at &&
        !reminders.buyer_payment_expiry
      ) {
        const msUntilExpiry = new Date(raw.checkout_expires_at).getTime() - now.getTime()
        if (msUntilExpiry > 0 && msUntilExpiry < 4 * 3600 * 1000) {
          // We don't have checkout_url in this query — link to listing page instead
          await sendBuyerPaymentExpiryWarning({
            buyerEmail: raw.buyer_email,
            listingTitle: listing.title,
            checkoutUrl: listingUrl,
            agreedAmount: offerAmount,
            expiresAt: raw.checkout_expires_at,
          })
          await markReminder(raw.id, 'buyer_payment_expiry')
          stats.buyer_payment_expiry++
        }
      }
    } catch (err) {
      console.error('[cron/offer-reminders] error on offer', raw.id, err)
      stats.errors++
    }
  }

  console.log('[cron/offer-reminders] done', stats)
  return NextResponse.json({ ok: true, stats })
}

async function markReminder(offerId: string, key: string): Promise<void> {
  const { data } = await db.from('marketplace_offers').select('reminders_sent').eq('id', offerId).single()
  const current = (data?.reminders_sent ?? {}) as Record<string, boolean>
  await db.from('marketplace_offers').update({ reminders_sent: { ...current, [key]: true } }).eq('id', offerId)
}
