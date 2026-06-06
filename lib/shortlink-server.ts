/**
 * lib/shortlink-server.ts
 *
 * Server-only namespace check for the flat mschz.org/[x] short-link space.
 * A segment is "taken" if it already resolves to something in the resolver's
 * order: a live shop slug, a retired shop slug (alias), or another listing's
 * custom slug / short code. Used by the availability endpoint and the listing
 * PUT (when a seller sets a custom product slug). Mirrors the middleware resolver.
 */

import 'server-only'
import { db } from '@/lib/supabase'

export async function isShortlinkSegmentTaken(
  seg: string,
  excludeProductId?: string,
): Promise<boolean> {
  const s = seg.trim().toLowerCase()
  if (!s) return false

  // 1) Live shop slug.
  const { data: shop } = await db
    .from('marketplace_shops').select('id').eq('slug', s).maybeSingle()
  if (shop) return true

  // 2) Retired shop slug (alias).
  const { data: alias } = await db
    .from('marketplace_shops').select('id')
    .contains('metadata', { previous_slug_keys: [s] }).limit(1).maybeSingle()
  if (alias) return true

  // 3) Another listing's custom slug or short code.
  for (const key of ['short_slug', 'short_code'] as const) {
    const { data } = await db
      .from('marketplace_listings').select('medusa_product_id')
      .contains('metadata', { [key]: s }).limit(1).maybeSingle()
    if (data && data.medusa_product_id !== excludeProductId) return true
  }

  return false
}
