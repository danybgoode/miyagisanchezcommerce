import { NextResponse, type NextRequest } from 'next/server'
import { countListings } from '@/lib/listings'
import type { SearchParams } from '@/lib/types'

// Live result count for the mobile filter sheet's "Ver X resultados" button.
// Takes the same filter params as /l search; returns only the total. buildQuery
// (inside countListings) allow-lists the keys, so passing every param is safe.
export async function GET(req: NextRequest) {
  const params: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((value, key) => {
    if (value) params[key] = value
  })

  // `market` is NOT read from the query string: the market of a public catalog read
  // is a property of the ROUTE, never of a buyer-supplied parameter, or `/l` would
  // become a door into any market by URL edit. Sprint 2's `/mx` routes pass it
  // explicitly; until then this resolves to DEFAULT_MARKET inside countListings.
  const { total, market_unavailable } = await countListings(params as SearchParams)
  if (market_unavailable) return NextResponse.json(market_unavailable, { status: 404 })
  return NextResponse.json({ total })
}
