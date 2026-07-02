/**
 * Miyagi Sánchez UCP MCP Server — personal MCP URL (Sprint 2 of
 * seller-agent-connect-mcp-url).
 *
 * claude.ai's custom-connector modal only accepts a remote MCP server URL (no
 * Bearer-header field), so the seller's credential has to ride in the URL
 * path instead: `https://miyagisanchez.com/api/ucp/mcp/c/<slug>`. This route
 * does its own gate (flag → slug shape → resolve-shop) and, on success,
 * forwards to the EXACT SAME dispatcher as the header-based `/api/ucp/mcp`
 * route by synthesizing `Authorization: Bearer ms_connector_<slug>` and
 * calling that route's already-exported `POST`/`GET` — zero changes to that
 * file, so the Bearer header path is provably unaffected. See
 * `lib/agent-auth.ts` for the shared resolver both credential shapes go
 * through.
 *
 * Gated by the `seller_agent.connector_url_enabled` kill-switch, checked
 * BEFORE any DB/auth work (flag → auth → config ordering, LEARNINGS).
 */

import { NextRequest, NextResponse } from 'next/server'
import { GET as baseMcpGet, POST as baseMcpPost } from '../../route'
import { resolveAgentShop, CONNECTOR_PREFIX } from '@/lib/agent-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
}

// Cheap shape check BEFORE any DB hit — rejects obviously-malformed path
// segments (wrong length/charset) with a 401, same as an unknown-but-well-
// formed slug. generateConnectorSlug() emits 32 base64url chars (24 random
// bytes); allow some headroom either side.
const SLUG_SHAPE = /^[A-Za-z0-9_-]{16,64}$/

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  if (!(await isEnabled('seller_agent.connector_url_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: CORS })
  }
  // Discovery info is identical regardless of slug — pure passthrough.
  return baseMcpGet(req)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const rl = await checkRateLimit('mcp', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded — too many requests' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  if (!(await isEnabled('seller_agent.connector_url_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: CORS })
  }

  const { slug } = await params
  if (!SLUG_SHAPE.test(slug)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS })
  }

  const credential = `${CONNECTOR_PREFIX}${slug}`
  const shop = await resolveAgentShop(`Bearer ${credential}`)
  if (!shop) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS })
  }

  // Forward to the shared dispatcher with the synthesized credential — the
  // client never sends (or needs to know about) this header at all.
  const bodyText = await req.text()
  const forwardedHeaders = new Headers(req.headers)
  forwardedHeaders.set('authorization', `Bearer ${credential}`)
  const forwarded = new NextRequest(req.url, {
    method: 'POST',
    headers: forwardedHeaders,
    body: bodyText,
  })

  return baseMcpPost(forwarded)
}
