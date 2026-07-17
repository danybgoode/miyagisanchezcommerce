/**
 * Miyagi Sánchez UCP MCP Server — PARTNER connector URL (miyagi-partners-mcp
 * S1.3). Mirrors the seller variant at ../c/[slug]/route.ts exactly:
 * claude.ai's custom-connector modal only accepts a URL (no Bearer-header
 * field), so the partner credential rides in the path —
 * `https://miyagisanchez.com/api/ucp/mcp/p/<slug>` — and this route
 * synthesizes `Authorization: Bearer ms_partner_<slug>` for the SAME shared
 * dispatcher. It never touches the DB itself; the plaintext-slug resolution +
 * grant checks all live in lib/partner-auth.ts's resolveToolShop, which every
 * seller tool already goes through. Rotation overwrites the stored slug,
 * which is what invalidates the old URL.
 *
 * Gated by `partners.mcp_enabled` (enablement, default OFF), checked BEFORE
 * any rate-limit/DB/auth work — a flag-off client must see a deterministic
 * 404, never a 429 that could imply the path exists while "disabled"
 * (flag → auth → config ordering; the exact 429-vs-404 codex catch from the
 * seller connector route, applied from birth here).
 */

import { NextRequest, NextResponse } from 'next/server'
import { GET as baseMcpGet, POST as baseMcpPost } from '../../route'
import { PARTNER_PREFIX } from '@/lib/agent-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
}

// Cheap shape check BEFORE any work — same headroom as the seller connector
// (generateConnectorSlug emits 32 base64url chars).
const SLUG_SHAPE = /^[A-Za-z0-9_-]{16,64}$/

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  if (!(await isEnabled('partners.mcp_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: CORS })
  }
  // Discovery info is identical regardless of slug — pure passthrough.
  return baseMcpGet(req)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isEnabled('partners.mcp_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: CORS })
  }

  const rl = await checkRateLimit('mcp', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded — too many requests' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { slug } = await params
  if (!SLUG_SHAPE.test(slug)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS })
  }

  // Forward to the shared dispatcher with the synthesized credential — the
  // per-call resolution (flag re-check, partner lookup, grant/role checks,
  // audit) happens inside resolveToolShop at every tool call. No pre-resolve
  // here: a partner credential is multi-shop, so unlike the seller variant
  // there is no single shop to 401 against before dispatch.
  const bodyText = await req.text()
  const forwardedHeaders = new Headers(req.headers)
  forwardedHeaders.set('authorization', `Bearer ${PARTNER_PREFIX}${slug}`)
  const forwarded = new NextRequest(req.url, {
    method: 'POST',
    headers: forwardedHeaders,
    body: bodyText,
  })

  return baseMcpPost(forwarded)
}
