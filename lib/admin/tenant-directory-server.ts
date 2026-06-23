/**
 * lib/admin/tenant-directory-server.ts
 *
 * Server-side reads for the admin tenant directory (`/admin/tenants`,
 * admin-consolidation · Sprint 3). Enumerates the `marketplace_shops` mirror,
 * counts each shop's live listings from the `marketplace_listings` mirror, reads
 * the custom-domain paywall flag ONCE, and maps every row through the pure
 * `shapeTenantRow` shaper.
 *
 * STRICT READ-MODEL: this module only reads. Medusa seller IDs (carried on each
 * mirror row's `metadata.medusa_seller_id`) are the canonical identity; the
 * mirror is the enumeration + display source. No Supabase (or Medusa) mutations.
 *
 * Imports `@/lib/flags` (server-only) — keep the pure shaping + types in
 * `lib/admin/tenant-directory.ts` so the Playwright `api` runner can unit-test
 * the seam without pulling in `server-only`/`flagsmith-nodejs`.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { DELETED_STATUS } from '@/lib/listing-lifecycle'
import { shapeTenantRow, type RawTenantRow, type TenantRow } from '@/lib/admin/tenant-directory'

/**
 * Count non-deleted listings per `shop_id` from the mirror — one read, counted in
 * memory (the way `neighborhood-pulse-server.ts` already aggregates), instead of
 * N per-seller Medusa calls. Mirror data = display/enrichment; never throws.
 */
async function listingCountsByShop(): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data, error } = await db
    .from('marketplace_listings')
    .select('shop_id, status')
    .neq('status', DELETED_STATUS)
  if (error || !data) {
    if (error) console.warn('[tenant-directory] listing counts unavailable:', error.message)
    return counts
  }
  for (const row of data as Array<{ shop_id: string | null; status: string | null }>) {
    if (!row.shop_id) continue
    counts.set(row.shop_id, (counts.get(row.shop_id) ?? 0) + 1)
  }
  return counts
}

/**
 * The read-only tenant directory: every mirror shop shaped into a display row.
 * Degrades to `[]` on a read failure so the admin page never throws.
 */
export async function listTenants(): Promise<TenantRow[]> {
  const [paywallEnabled, counts] = await Promise.all([
    isEnabled('domain.paywall_enabled'),
    listingCountsByShop(),
  ])

  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name, clerk_user_id, custom_domain, custom_domain_verified, metadata, created_at')
    .order('name', { ascending: true })

  if (error || !data) {
    if (error) console.warn('[tenant-directory] shops unavailable:', error.message)
    return []
  }

  return (data as RawTenantRow[]).map((raw) =>
    shapeTenantRow(raw, { paywallEnabled, listingCount: counts.get(raw.id) ?? 0 }),
  )
}
