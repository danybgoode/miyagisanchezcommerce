/**
 * POST /api/sell/shop/subdomain/switch
 *
 * Switch a live subdomain subscription between monthly and yearly (epic 07 ·
 * subdomain-pricing, Sprint 3) — WITHOUT a double charge or an entitlement gap.
 * A thin wrapper over the shared `switchSubdomainCadence` builder (also used by the
 * MCP `switch_subdomain_cadence` tool), which does a Stripe proration price-swap on
 * the SAME subscription (see lib/subdomain-switch.ts).
 *
 * Body: `{ interval: 'month' | 'year' }` — the target cadence.
 *
 * Auth required (seller session) — checked BEFORE any plan/Stripe resolution, so an
 * anonymous request is a clean 401 (never a 500 from a missing secret).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { switchSubdomainCadence } from '@/lib/subdomain-switch'

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Debes iniciar sesión.', code: 'AUTH_REQUIRED' },
      { status: 401 },
    )
  }

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let interval: string | null = null
  try {
    const body = (await req.json()) as { interval?: unknown }
    if (typeof body?.interval === 'string') interval = body.interval
  } catch {
    // No / empty body — the builder coerces a missing interval to yearly.
  }

  const result = await switchSubdomainCadence({
    sellerClerkId: user.id,
    targetInterval: interval,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ ok: true, switched: result.switched, interval: result.interval })
}
