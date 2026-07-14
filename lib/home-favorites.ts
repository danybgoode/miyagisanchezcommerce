import { db } from '@/lib/supabase'

/**
 * Homepage Polish — Dirección B · Sprint 4: the signed-in "Retoma donde te quedaste"
 * rail read. Reuses the same `marketplace_favorites → marketplace_listings →
 * marketplace_shops` join as `app/account/favorites/page.tsx` / `GET /api/favorites`,
 * limited to the newest `n` active favorites. DB-touching (so it lives outside the
 * pure seam), null-safe — degrades to `[]` on no user / no rows / error so the rail
 * ships independent of any data. No price-drop badge in v1 (deferred).
 */

export interface RecentFavorite {
  /** Medusa product id — the rail card links to `/l/${medusaId}`. */
  medusaId: string
  title: string
  priceCents: number | null
  currency: string
  condition: string | null
  location: string | null
  imageUrl: string | null
  /** Snapshot of `price_cents` at favorite-time (`marketplace_favorites.price_cents_at_save`,
   *  written by `app/api/favorites/route.ts` on favorite). `null` for favorites saved before
   *  that column existed — the S2.2 price-drop badge just degrades to "no badge" then. */
  priceCentsAtSave: number | null
}

interface FavoriteRow {
  price_cents_at_save: number | null
  marketplace_listings: {
    medusa_product_id: string | null
    title: string
    price_cents: number | null
    currency: string | null
    condition: string | null
    location: string | null
    images: Array<{ url: string }> | null
    status: string
  } | null
}

/** Newest `n` active favorites for the rail. Active-only + must have a Medusa id (linkable). */
export async function getRecentFavorites(
  clerkUserId: string | null | undefined,
  n = 3,
): Promise<RecentFavorite[]> {
  if (!clerkUserId) return []

  const { data, error } = await db
    .from('marketplace_favorites')
    .select(`
      price_cents_at_save,
      marketplace_listings (
        medusa_product_id, title, price_cents, currency, condition, location, images, status
      )
    `)
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[home-favorites] read failed:', error)
    return []
  }

  return ((data ?? []) as unknown as FavoriteRow[])
    .filter((row): row is FavoriteRow & { marketplace_listings: NonNullable<FavoriteRow['marketplace_listings']> } =>
      !!row.marketplace_listings && row.marketplace_listings.status === 'active' && !!row.marketplace_listings.medusa_product_id)
    .slice(0, n)
    .map(row => ({
      medusaId: row.marketplace_listings.medusa_product_id!,
      title: row.marketplace_listings.title,
      priceCents: row.marketplace_listings.price_cents,
      currency: (row.marketplace_listings.currency ?? 'MXN').toUpperCase(),
      condition: row.marketplace_listings.condition,
      location: row.marketplace_listings.location,
      imageUrl: row.marketplace_listings.images?.[0]?.url ?? null,
      priceCentsAtSave: row.price_cents_at_save,
    }))
}
