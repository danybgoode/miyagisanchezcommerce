import { NextRequest, NextResponse } from 'next/server'
import { getNeighborhoodSpotlightShops } from '@/lib/neighborhood-pulse-server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawLimit = Number(searchParams.get('limit') ?? 6)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 12) : 6
  const shops = await getNeighborhoodSpotlightShops(limit)

  return NextResponse.json(
    {
      shops,
      _meta: {
        view: 'neighborhood-pulse-spotlight',
        read_only: true,
      },
    },
    { headers: CORS },
  )
}
