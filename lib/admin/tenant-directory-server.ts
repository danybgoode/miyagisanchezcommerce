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
 * the seam without pulling in `server-only` (and the Supabase client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { DELETED_STATUS } from '@/lib/listing-lifecycle'
import { mapWithConcurrency, shapeTenantRow, type RawTenantRow, type TenantRow } from '@/lib/admin/tenant-directory'
import { getShop } from '@/lib/listings'
import { readPublicSellerMarket, type PublicSellerMarket } from '@/lib/owned-market'
import { getSellerEmail } from '@/lib/email'
import { readSellerStatus, statusForRow } from '@/lib/admin/tenant-status'
import { medusaSellerIdOf } from '@/lib/admin/tenant-directory'
import type { SellerStatus } from '@/lib/seller-status'

const PUBLIC_SELLER_READ_CONCURRENCY = 8
/**
 * Clerk's Management API is rate-limited and the directory fans one call per claimed
 * shop. Same bounding as the market projection read for the same reason (D5).
 */
const CLERK_EMAIL_CONCURRENCY = 6

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

  const rows = data as RawTenantRow[]
  // The mirror is only the enumerable list spine. Market state is read from
  // Medusa's public seller projection; an unavailable projection stays visibly
  // unavailable instead of inheriting a made-up MX default.
  const markets = new Map<string, PublicSellerMarket | null>(await mapWithConcurrency(
    rows,
    PUBLIC_SELLER_READ_CONCURRENCY,
    async (raw) => {
    // `getShop` is a bare `fetch` with no error handling of its own, so a network
    // fault, timeout or malformed body REJECTS rather than returning null. Inside
    // a Promise.all that would reject the whole batch and 500 the directory —
    // breaking this function's contract two doc-comments up ("degrades to [] on a
    // read failure so the admin page never throws") over one unreachable seller.
    // An unreadable projection is the UNAVAILABLE state, which `readPublicSellerMarket`
    // already renders as "Mercado operativo no disponible" — never a made-up MX default.
    let seller = null
    try {
      seller = raw.slug ? await getShop(raw.slug) : null
    } catch (error) {
      console.warn(`[tenant-directory] seller projection unavailable for ${raw.slug}:`, error)
    }
    return [raw.id, readPublicSellerMarket(seller)] as const
    },
  ))

  // Lifecycle status, from Medusa — the canonical owner of the fact (D1). An
  // unreachable backend yields `null`, which the shaper and the UI render as
  // "no disponible" and never as "activa".
  const statuses = new Map<string, SellerStatus | 'not_imported' | 'absent' | 'unavailable'>(await mapWithConcurrency(
    rows,
    PUBLIC_SELLER_READ_CONCURRENCY,
    async (raw) => {
      const read = await readSellerStatus(medusaSellerIdOf(raw.metadata))
      if (read.state === 'unavailable') {
        console.warn(`[tenant-directory] status unavailable for ${raw.slug}: ${read.reason}`)
      }
      // `absent` (Medusa has no such seller — an orphaned mirror row, a data-repair
      // job) and `unavailable` (transient) are carried through DISTINCTLY. Collapsing
      // them, as the first revision did, meant an orphan read as a glitch nobody
      // would ever go fix.
      return [raw.id, statusForRow(read)] as const
    },
  ))

  // Registration email, read from Clerk at request time and NEVER stored (D5).
  // Copying it into the mirror would create a second, staler source of a personal
  // datum; Clerk stays the SSOT.
  const emails = new Map<string, string | null | 'unavailable'>(await mapWithConcurrency(
    rows,
    CLERK_EMAIL_CONCURRENCY,
    async (raw) => {
      // An unclaimed shop has no Clerk user, so it has no email — that is `null`, a
      // real answer, distinct from "we could not ask".
      if (!raw.clerk_user_id) return [raw.id, null] as const
      try {
        const email = await getSellerEmail(raw.clerk_user_id)
        // `getSellerEmail` swallows its own failures and returns null, so a null here
        // is ambiguous between "no address on the account" and "Clerk was
        // unreachable". Both are reported as unavailable rather than as a blank cell
        // that reads like "this merchant has no email".
        return [raw.id, email ?? ('unavailable' as const)] as const
      } catch {
        return [raw.id, 'unavailable' as const] as const
      }
    },
  ))

  return rows.map((raw) =>
    shapeTenantRow(raw, {
      paywallEnabled,
      listingCount: counts.get(raw.id) ?? 0,
      publicSellerMarket: markets.get(raw.id) ?? null,
      status: statuses.get(raw.id) ?? 'unavailable',
      registrationEmail: emails.get(raw.id) ?? 'unavailable',
    }),
  )
}
