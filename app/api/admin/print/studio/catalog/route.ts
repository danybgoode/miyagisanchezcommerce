/**
 * GET /api/admin/print/studio/catalog?q=…  (`withPrintStudio`)
 * Live marketplace listing search (Medusa Store API via searchListings, AGENTS
 * rule #1) — same shape as the Clerk-only `/api/admin/print/catalog` route,
 * via the shared `toCatalogItems` mapper; catalog pull into zine lands in
 * Sprint 2 (2.2), this just gives the studio the same read the web builder
 * already has.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPrintStudio } from '@/lib/admin/guard'
import { searchListings, toCatalogItems } from '@/lib/listings'

export const dynamic = 'force-dynamic'

export const GET = withPrintStudio(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? ''

  const { listings } = await searchListings({ q, page: '1' })
  return NextResponse.json({ items: toCatalogItems(listings) })
})
