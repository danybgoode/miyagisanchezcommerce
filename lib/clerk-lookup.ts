/**
 * Reverse Clerk identity lookup: email → Clerk user id.
 *
 * A Medusa order only ever carries `order.email` — Clerk's own SDK is the
 * only reliable way to find the buyer's Clerk account from it (Medusa's
 * customer table has no external_id linking the two — see
 * `apps/backend/.../_utils/clerk-auth.ts`'s header comment, which solves the
 * OPPOSITE direction: Clerk id → email). Used by the proof-send flow
 * (custom-print-products S4 · 4.1) to find/create the buyer-seller
 * conversation for an order that has no existing conversation/offer.
 *
 * Best-effort: returns null on any failure (no Clerk account for that email,
 * API error, missing secret) rather than throwing — a missing buyer id just
 * means the conversation link can't be created yet.
 */
import 'server-only'

export async function resolveClerkUserIdByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  try {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const { data } = await client.users.getUserList({ emailAddress: [normalized], limit: 1 })
    return data[0]?.id ?? null
  } catch {
    return null
  }
}
