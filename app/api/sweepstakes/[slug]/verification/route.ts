import { NextRequest, NextResponse } from 'next/server'
import {
  campaignIsWithinEntryWindow,
  getCampaignBySlug,
  getSweepstakesSettings,
  isValidEmail,
  sendSweepstakesCode,
} from '@/lib/sweepstakes'
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

  const settings = await getSweepstakesSettings()
  if (!settings.enabled) return NextResponse.json({ error: 'sweepstakes_disabled' }, { status: 423 })

  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!campaignIsWithinEntryWindow(campaign)) return NextResponse.json({ error: 'not_active' }, { status: 422 })

  let body: { email?: string; locale?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }
  if (!body.email || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  try {
    await sendSweepstakesCode(campaign, body.email, body.locale)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[sweepstakes] verification send failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
