import { NextRequest, NextResponse } from 'next/server'
import {
  createOrRefreshEventVerification,
  eventRegistrationIsOpen,
  getEventBySlug,
  isValidEmail,
} from '@/lib/events'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const rl = await checkRateLimit('sweepstakes', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!eventRegistrationIsOpen(event)) return NextResponse.json({ error: 'not_active' }, { status: 422 })

  let body: { email?: string; locale?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }
  if (!body.email || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  try {
    const result = await createOrRefreshEventVerification({ event, email: body.email, locale: body.locale })
    if (result.capacityFull) return NextResponse.json({ error: 'capacity_full' }, { status: 409 })
    return NextResponse.json({
      ok: true,
      already_registered: result.alreadyRegistered,
      ticket_token: result.ticket_token ?? null,
      ticket_qr_url: result.ticket_qr_url ?? null,
    })
  } catch (e) {
    console.error('[events] verification send failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
