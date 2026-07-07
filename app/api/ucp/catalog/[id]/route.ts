/**
 * GET /api/ucp/catalog/:id
 *
 * Returns full UCP listing detail for a single listing.
 * Data source: Medusa headless backend via /store/listings/:id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { toUcpListing } from '@/lib/ucp/schema'
import { isEmbedRequest } from '@/lib/embed-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { getPriceGrid } from '@/lib/listings'
import type { Listing } from '@/lib/types'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const baseUrl = req.headers.get('origin') ?? 'https://miyagisanchez.com'

  // Widget traffic is rate-limited; agents/marketplace are not. No-op w/o Redis.
  if (isEmbedRequest(req)) {
    const rl = await checkRateLimit('embed', getClientIp(req))
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes.' },
        { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
      )
    }
  }

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing listing id' }, { status: 400, headers: CORS })
  }

  const res = await fetch(`${MEDUSA_BASE}/store/listings/${id}`, {
    headers: { 'x-publishable-api-key': PUB_KEY },
    next: { revalidate: 60 } as RequestInit['next'],
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404, headers: CORS })
  }

  const data = await res.json()
  const listing = data.listing as Listing
  const priceGrid = await getPriceGrid(listing.medusa_product_id ?? listing.id)

  return NextResponse.json(toUcpListing(listing, baseUrl, priceGrid), { headers: CORS })
}
