import { currentUser } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getActiveDealForBuyer } from '@/lib/active-deal'
import { getListing, getOwnedShopListing } from '@/lib/listings'
import { db } from '@/lib/supabase'
import {
  SIGNED_OUT_PDP_VIEWER_STATE,
  type PdpViewerState,
} from '@/lib/pdp-viewer-state'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/** D8: the only personalized read used by the public PDP HTML. */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get('listingId')
  const shopSlug = req.nextUrl.searchParams.get('shopSlug')
  if (!listingId) {
    return NextResponse.json({ error: 'listingId requerido.' }, { status: 400, headers: NO_STORE })
  }

  try {
    const user = await currentUser()
    if (!user) return NextResponse.json(SIGNED_OUT_PDP_VIEWER_STATE, { headers: NO_STORE })

    const listing = shopSlug
      ? await getOwnedShopListing(shopSlug, listingId)
      : await getListing(listingId, 'mx')
    if (!listing) {
      return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404, headers: NO_STORE })
    }

    const [favorite, activeDeal] = await Promise.all([
      db
        .from('marketplace_favorites')
        .select('id, marketplace_listings!inner(medusa_product_id)')
        .eq('clerk_user_id', user.id)
        .eq('marketplace_listings.medusa_product_id', listingId)
        .maybeSingle(),
      getActiveDealForBuyer(listingId, user.id),
    ])
    if (favorite.error) throw favorite.error

    const state: PdpViewerState = {
      signedIn: true,
      ownsListing: listing.shop?.clerk_user_id === user.id,
      favorited: !!favorite.data,
      activeDeal,
      buyerPrefill: {
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        email: user.emailAddresses[0]?.emailAddress ?? '',
      },
    }
    return NextResponse.json(state, { headers: NO_STORE })
  } catch (error) {
    console.error('[pdp-viewer-state] read failed', error)
    return NextResponse.json({ error: 'Estado no disponible.' }, { status: 503, headers: NO_STORE })
  }
}
