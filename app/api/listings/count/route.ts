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

  const total = await countListings(params as SearchParams)
  return NextResponse.json({ total })
}
