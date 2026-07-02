/**
 * GET /api/admin/print/catalog?q=…  (Clerk admin-gated via withAdmin)
 * Searches LIVE marketplace listings (Medusa Store API via searchListings, AGENTS
 * rule #1) for the builder's curation drawer (US-4). Returns slim listing + shop
 * shapes the client maps into house-ad blocks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { searchListings, toCatalogItems } from '@/lib/listings'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? ''

  const { listings } = await searchListings({ q, page: '1' })
  return NextResponse.json({ items: toCatalogItems(listings) })
})
