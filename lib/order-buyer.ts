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
