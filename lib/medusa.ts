import Medusa from '@medusajs/js-sdk'

const BASE_URL = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

// Singleton Medusa JS SDK client.
// Use this for ALL commerce data: products, cart, orders, customers, fulfillment.
// Never use db (Supabase) for commerce concerns.
export const medusa = new Medusa({
  baseUrl: BASE_URL,
  publishableKey: PUBLISHABLE_KEY,
})

// Helper: authenticated Store API call using a Clerk JWT.
// Pass the token from Clerk's getToken() or currentUser().
export function authedMedusa(clerkJwt: string) {
  return new Medusa({
    baseUrl: BASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    apiKey: clerkJwt,
  })
}

// The seeded Medusa Region / Sales Channel ids used to live here as two module
// constants (`MXN_REGION_ID`, `DEFAULT_SALES_CHANNEL_ID`). They are gone on
// purpose: a bare constant named after ONE country is the single-market assumption
// this epic removes (decision D5). Resolve them from a market instead —
//
//   import { resolveRegionIdForMarket, PROCESS_MARKET_ENV } from '@/lib/market-medusa'
//   resolveRegionIdForMarket(market, PROCESS_MARKET_ENV)
//
// — which fails closed on an unknown market and answers `null` for a market that
// has no Region, instead of silently handing back Mexico's.
