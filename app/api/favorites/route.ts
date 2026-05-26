import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

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
        id, title, price_cents, currency, condition, location, images, status, created_at,
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

  // Check if already favorited
  const { data: existing } = await db
    .from('marketplace_favorites')
    .select('id')
    .eq('clerk_user_id', user.id)
    .eq('listing_id', body.listingId)
    .maybeSingle()

  if (existing) {
    // Remove favorite
    await db.from('marketplace_favorites').delete().eq('id', existing.id)
    return NextResponse.json({ favorited: false })
  }

  // Get current price for tracking
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('price_cents')
    .eq('id', body.listingId)
    .maybeSingle()

  await db.from('marketplace_favorites').insert({
    clerk_user_id: user.id,
    listing_id: body.listingId,
    price_cents_at_save: listing?.price_cents ?? null,
  })

  return NextResponse.json({ favorited: true })
}
