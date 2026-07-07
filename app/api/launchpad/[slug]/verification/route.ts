/**
 * POST /api/launchpad/[slug]/verification — send a 6-char email code to a writer
 * about to submit a manuscript. No account (Clerk) required — the email code IS
 * the identity check (bookshop-launchpad S1.1). Mirrors the sweepstakes
 * verification route: rate-limit → flag → opt-in → send.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopBySlug, sendLaunchpadCode, isValidEmail } from '@/lib/launchpad'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const rl = await checkRateLimit('launchpad', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }

  const { slug } = await params
  const shop = await getLaunchpadShopBySlug(slug)
  if (!shop) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!shop.acceptsManuscripts) return NextResponse.json({ error: 'not_accepting' }, { status: 422 })

  let body: { email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }
  if (!body.email || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  try {
    await sendLaunchpadCode(shop, body.email)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[launchpad] verification send failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
