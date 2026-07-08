/**
 * lib/order-buyer.ts
 *
 * Buyer notifications — money path (epic 05), Sprint 1, Story 1.2.
 *
 * Pure resolution seam for the buyer's Clerk id at Medusa-order dispatch sites
 * (ship-manual, ship, return-request/[requestId]) — null-safe, flag-off
 * short-circuits to null (today's guest fall-through via dispatchToBuyer).
 */

export function resolveBuyerClerkId(
  rawClerkUserId: string | null | undefined,
  flagEnabled: boolean,
): string | null {
  return flagEnabled ? (rawClerkUserId ?? null) : null
}

/**
 * Strips `buyer_clerk_user_id` before an order object crosses the server/client
 * boundary. It's a stable Clerk auth identifier — server-side dispatch routes
 * (ship-manual/ship/return-request) need it, but a seller's browser never should
 * (found in cross-agent review: the seller orders list/detail pages spread the
 * full normalizeMedusaOrder object into a 'use client' component's props).
 */
export function stripBuyerClerkId<T extends Record<string, unknown>>(
  obj: T,
): Omit<T, 'buyer_clerk_user_id'> {
  const { buyer_clerk_user_id: _omit, ...rest } = obj as T & { buyer_clerk_user_id?: unknown }
  return rest
}
