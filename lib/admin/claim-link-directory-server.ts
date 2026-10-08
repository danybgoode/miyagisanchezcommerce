import 'server-only'
import { readTenantDirectory } from './tenant-directory-server'
import { mapWithConcurrency } from './tenant-directory'
import { isShopPreviewPrivateForShop } from '@/lib/preview-access'

/** Match the public shop's privacy guard before offering its view link. */
export async function readClaimLinkDirectory() {
  const directory = await readTenantDirectory()
  if (directory.state === 'unavailable') return directory
  const rows = await mapWithConcurrency(directory.rows, 8, async (row) => {
    if (row.publicSellerClaimed === true) return { ...row, publicPreviewAvailable: true }
    if (row.publicSellerClaimed !== false || !row.slug) return { ...row, publicPreviewAvailable: null }
    try {
      const privateOrUnreadable = await isShopPreviewPrivateForShop({ slug: row.slug, clerk_user_id: null })
      return { ...row, publicPreviewAvailable: !privateOrUnreadable }
    } catch (error) {
      console.warn(`[claim-link-directory] preview unavailable for ${row.slug}:`, error)
      return { ...row, publicPreviewAvailable: null }
    }
  })
  return { state: 'resolved' as const, rows }
}
