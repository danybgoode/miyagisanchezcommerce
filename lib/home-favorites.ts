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
}

interface FavoriteRow {
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
    .map(row => row.marketplace_listings)
    .filter((l): l is NonNullable<FavoriteRow['marketplace_listings']> =>
      !!l && l.status === 'active' && !!l.medusa_product_id)
    .slice(0, n)
    .map(l => ({
      medusaId: l.medusa_product_id!,
      title: l.title,
      priceCents: l.price_cents,
      currency: (l.currency ?? 'MXN').toUpperCase(),
      condition: l.condition,
      location: l.location,
      imageUrl: l.images?.[0]?.url ?? null,
    }))
}
