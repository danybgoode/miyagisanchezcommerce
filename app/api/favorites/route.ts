import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

async function resolveListingFavoriteTarget(listingId: string) {
  const { data: byMedusa } = await db
    .from('marketplace_listings')
    .select('id, price_cents')
    .eq('medusa_product_id', listingId)
    .maybeSingle()
  if (byMedusa) return byMedusa

  if (!isUuid(listingId)) return null
  const { data: byId } = await db
    .from('marketplace_listings')
    .select('id, price_cents')
    .eq('id', listingId)
    .maybeSingle()
  return byId ?? null
}

// ── GET — list all favorites for current user ─────────────────────────────────

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('marketplace_favorites')
    .select(`
      id,
      listing_id,
      price_cents_at_save,
      created_at,
      marketplace_listings (
        id, medusa_product_id, title, price_cents, currency, condition, location, images, status, created_at,
        marketplace_shops ( name, slug, verified )
      )
    `)
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ favorites: data ?? [] })
}

// ── POST — toggle favorite (add if missing, remove if exists) ─────────────────

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const body = await req.json() as { listingId?: string }
  if (!body.listingId) return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })

  const listing = await resolveListingFavoriteTarget(body.listingId)
  if (!listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })

  // Check if already favorited
  const { data: existing } = await db
    .from('marketplace_favorites')
    .select('id')
    .eq('clerk_user_id', user.id)
    .eq('listing_id', listing.id)
    .maybeSingle()

  if (existing) {
    // Remove favorite
    await db.from('marketplace_favorites').delete().eq('id', existing.id)
    return NextResponse.json({ favorited: false })
  }

  const { error } = await db.from('marketplace_favorites').insert({
    clerk_user_id: user.id,
    listing_id: listing.id,
    price_cents_at_save: listing?.price_cents ?? null,
  })
  if (error) {
    console.error('[favorites] insert failed:', error)
    return NextResponse.json({ error: 'No se pudo guardar el favorito.' }, { status: 500 })
  }

  return NextResponse.json({ favorited: true })
}
