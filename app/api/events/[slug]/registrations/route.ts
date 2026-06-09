import { NextRequest, NextResponse } from 'next/server'
import {
  eventRegistrationIsOpen,
  getEventBySlug,
  isValidEmail,
  verifyEventRegistration,
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

  let body: { name?: string; email?: string; code?: string; locale?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }

  if (!body.name?.trim() || !body.email || !body.code?.trim() || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 422 })
  }

  try {
    const result = await verifyEventRegistration({
      event,
      name: body.name,
      email: body.email,
      code: body.code,
      locale: body.locale,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'unavailable' }, { status: result.capacityFull ? 409 : 422 })
    }
    return NextResponse.json({
      ok: true,
      already_registered: result.alreadyRegistered === true,
      registration_id: result.registration?.id,
      registered_count: result.stats?.registrations ?? 0,
      capacity_remaining: result.stats?.capacity_remaining ?? null,
    })
  } catch (e) {
    console.error('[events] registration failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
