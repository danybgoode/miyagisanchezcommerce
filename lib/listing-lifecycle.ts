/**
 * Listing lifecycle — the single source of truth for the "deleted" state mapping
 * (Seller bug sweep · S2). A deleted listing is soft-deleted in Medusa
 * (`deleted_at`) and carries `status: 'deleted'` in the Supabase mirror. This
 * pure, next-free module lets the manage dashboard agree "gone" with the mirror
 * and the edit guard — and stay deploy-lag-safe in the window before the backend
 * soft-delete deploys (a still-drafted-but-mirror-deleted product must be hidden,
 * and must NOT be re-synced from Medusa back into the mirror as 'draft').
 */

/** The mirror status that means a listing has been deleted. */
export const DELETED_STATUS = 'deleted'

/** True when a mirror status marks the listing as deleted. */
export function isDeletedStatus(status: string | null | undefined): boolean {
  return status === DELETED_STATUS
}

/**
 * Drop any listing whose id is in the mirror's deleted set. Used for BOTH the
 * rendered manage grid AND the mirror-resync loop, so a deleted listing is
 * hidden from the seller and is never written back to the mirror as 'draft'
 * (which would resurrect it in the edit guard) during the backend deploy-lag
 * window. Once the backend soft-delete is live, Medusa already omits the
 * product, so `deletedIds` is empty and this is a no-op.
 */
export function filterOutDeleted<T extends { id: string }>(
  listings: T[],
  deletedIds: Set<string>,
): T[] {
  if (deletedIds.size === 0) return listings
  return listings.filter((listing) => !deletedIds.has(listing.id))
}
