import { NextRequest, NextResponse } from 'next/server'
import { getNeighborhoodPulseAgentView } from '@/lib/neighborhood-pulse-agent'
import { isMarketUnavailable, planMarketCatalogRead } from '@/lib/market-catalog'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

function limitParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const raw = Number(searchParams.get(key) ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`
  const marketDecision = planMarketCatalogRead(searchParams.get('market'))
  if (isMarketUnavailable(marketDecision)) {
    return NextResponse.json(
      marketDecision,
      { status: marketDecision.market_code ? 404 : 400, headers: CORS },
    )
  }

  const pulse = await getNeighborhoodPulseAgentView(baseUrl, {
    itemLimit: limitParam(searchParams, 'community_limit', 12),
    listingLimit: limitParam(searchParams, 'trending_limit', 8),
    shopLimit: limitParam(searchParams, 'shop_limit', 6),
  }, marketDecision.market.code)

  return NextResponse.json(pulse, { headers: CORS })
}
