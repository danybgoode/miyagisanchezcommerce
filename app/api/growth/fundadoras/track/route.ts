/**
 * POST /api/growth/fundadoras/track — anonymous, PII-free client funnel events
 * for the Tiendas Fundadoras campaign (epic tiendas-fundadoras-acquisition,
 * Story 2.3).
 *
 * Deliberately NOT the Clerk-authed `/api/growth/track`: the campaign is a
 * PUBLIC, logged-out surface, so its funnel events (view / cta / start /
 * validation_failed) carry an OPAQUE client-generated subject id, never a user
 * id and never a form value. The `accepted` event is NOT accepted here — it is
 * emitted server-side from the apply route only, after the canonical write, so
 * that acceptance can never be forged from the client.
 *
 * Every payload is rebuilt server-side by `buildFundadorasEventPayload`, which
 * allowlists both the event name and the tag keys — a body stuffed with extra
 * fields has them silently dropped, not forwarded. Gated by
 * `growth.telemetry_enabled`; a router failure degrades safely (fire-and-forget)
 * and is only ever observable in logs, never breaks the page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import {
  isFundadorasEvent,
  isPlausibleOpaqueSubjectId,
  buildFundadorasEventPayload,
} from '@/lib/fundadoras-application'
import { sendGrowthEvent } from '@/lib/growth-engine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // A modest IP rate limit — the same public-form bucket is fine; a funnel
  // ping is cheaper than an application but still worth capping.
  const rl = await checkRateLimit('fundadoras_apply', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { event, subjectId, tags } = (body ?? {}) as Record<string, unknown>

  // Allowlist the event name. `accepted` is emitted server-side only — reject
  // it here so a client can never mint an acceptance.
  if (typeof event !== 'string' || !isFundadorasEvent(event) || event === 'fundadoras_application_accepted') {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  }
  if (typeof subjectId !== 'string' || !isPlausibleOpaqueSubjectId(subjectId)) {
    return NextResponse.json({ error: 'Invalid subject' }, { status: 400 })
  }

  const enabled = await isEnabled('growth.telemetry_enabled')
  if (!enabled) {
    // Telemetry off: accept quietly so the client never treats it as an error.
    return NextResponse.json({ skipped: true }, { status: 200 })
  }

  const payload = buildFundadorasEventPayload(
    event,
    subjectId,
    typeof tags === 'object' && tags !== null ? (tags as Record<string, unknown>) : undefined,
  )
  // Fire-and-forget — never block or fail the client on a telemetry hiccup.
  sendGrowthEvent(payload).catch((e) => console.error('[fundadoras-track] growth emit failed:', e))

  return NextResponse.json({ ok: true }, { status: 202 })
}
