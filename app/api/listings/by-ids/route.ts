import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'

/**
 * GET /api/listings/by-ids?ids=prod_1,prod_2,...
 *
 * home-dynamic-rows-restore-and-polish S2.3 — ONE batched public listing read for the
 * homepage rail's recently-viewed cards (ids come from the visitor's own device-local
 * localStorage, never a mutation). No auth — same trust level as `/api/ucp/catalog`
 * (public, read-only listing display data). Mirrors the exact `marketplace_listings`
 * read-for-display convention already used by `lib/home-favorites.ts` / this same
 * `app/api/favorites/route.ts` — not a new architectural pattern.
 *
 * Fail-open: any Supabase error → `{ listings: [] }`, never a 500 (the rail just shows
 * fewer/no viewed cards, same degrade-safe shape as the rest of this personalization
 * surface).
 */

const MAX_IDS = 20

interface ListingCardData {
  medusaId: string
  title: string
  priceCents: number | null
  currency: string
  condition: string | null
  location: string | null
  imageUrl: string | null
}

interface ListingRow {
  medusa_product_id: string
  title: string
  price_cents: number | null
  currency: string | null
  condition: string | null
  location: string | null
  images: Array<{ url: string }> | null
  status: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ids = Array.from(
    new Set(
      (searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_IDS)

  if (ids.length === 0) return NextResponse.json({ listings: [] })

  const { data, error } = await db
    .from('marketplace_listings')
    .select('medusa_product_id, title, price_cents, currency, condition, location, images, status')
    .in('medusa_product_id', ids)
    .eq('status', 'active')

  if (error) {
    console.error('[listings/by-ids] read failed:', error)
    return NextResponse.json({ listings: [] })
  }

  const listings: ListingCardData[] = ((data ?? []) as ListingRow[]).map((l) => ({
    medusaId: l.medusa_product_id,
    title: l.title,
    priceCents: l.price_cents,
    currency: (l.currency ?? 'MXN').toUpperCase(),
    condition: l.condition,
    location: l.location,
    imageUrl: l.images?.[0]?.url ?? null,
  }))

  return NextResponse.json({ listings })
}
