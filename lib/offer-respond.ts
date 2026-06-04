/**
 * Shared offer operations — used by both the seller portal and the seller's MCP
 * agent so a human clicking "aceptar" and an agent calling `respond_to_offer`
 * run the exact same code path (Seller Agent Operations · Sprint 1).
 *
 * `listShopOffers` powers the `list_offers` tool. `respondToOffer` (added in
 * US-2) holds the accept/counter/decline logic extracted from the existing
 * route, parameterized by the authorized seller's Clerk user id so the ownership
 * check is identical whether the caller is a signed-in seller or a scoped agent.
 */

import { db } from './supabase'
import { offerQuality, formatOfferAmount, timeUntil, type OfferStatus } from './offers'

export interface AgentOfferView {
  id: string
  listing_id: string
  listing_title: string
  status: OfferStatus
  offer_amount: string
  list_price: string
  pct_of_asking: number
  quality: string
  buyer_name: string
  message: string | null
  expires_in: string
  counter_amount: string | null
}

interface OfferRow {
  id: string
  offer_amount_cents: number
  message: string | null
  status: OfferStatus
  expires_at: string
  counter_amount_cents: number | null
  buyer_name: string
  listing_id: string
  marketplace_listings: { id: string; title: string; price_cents: number; currency: string }
}

/**
 * List a shop's non-terminal offers (newest first, pending first). With
 * `actionableOnly`, returns just the offers the seller can act on (`pending`).
 * Scoped by `shop_id` — never returns another shop's offers.
 */
export async function listShopOffers(
  shopId: string,
  opts?: { actionableOnly?: boolean },
): Promise<AgentOfferView[]> {
  const { data } = await db
    .from('marketplace_offers')
    .select(`
      id, offer_amount_cents, message, status, expires_at, counter_amount_cents, buyer_name, listing_id,
      marketplace_listings!inner(id, title, price_cents, currency)
    `)
    .eq('shop_id', shopId)
    .not('status', 'in', '("withdrawn","expired","paid")')
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (data ?? []) as unknown as OfferRow[]
  const filtered = opts?.actionableOnly ? rows.filter((r) => r.status === 'pending') : rows

  return filtered.map((r) => {
    const l = r.marketplace_listings
    const q = offerQuality(r.offer_amount_cents, l.price_cents)
    return {
      id: r.id,
      listing_id: r.listing_id,
      listing_title: l.title,
      status: r.status,
      offer_amount: formatOfferAmount(r.offer_amount_cents, l.currency),
      list_price: formatOfferAmount(l.price_cents, l.currency),
      pct_of_asking: q.pct,
      quality: q.label,
      buyer_name: r.buyer_name,
      message: r.message,
      expires_in: timeUntil(r.expires_at),
      counter_amount: r.counter_amount_cents ? formatOfferAmount(r.counter_amount_cents, l.currency) : null,
    }
  })
}
