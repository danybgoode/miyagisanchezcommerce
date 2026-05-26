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

// Seeded IDs — set once on first Medusa setup, stable across environments.
export const MXN_REGION_ID = process.env.MEDUSA_MXN_REGION_ID ?? ''
export const DEFAULT_SALES_CHANNEL_ID = process.env.MEDUSA_SALES_CHANNEL_ID ?? ''
