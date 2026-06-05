import { NextRequest, NextResponse } from 'next/server'
import {
  campaignIsWithinEntryWindow,
  createOrReturnSweepstakesEntry,
  getCampaignBySlug,
  getSweepstakesSettings,
  isValidEmail,
  verifySweepstakesCode,
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

  let body: { name?: string; email?: string; code?: string; locale?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }

  if (!body.name?.trim() || !body.email || !body.code?.trim() || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 422 })
  }

  const verified = await verifySweepstakesCode(campaign, body.email, body.code)
  if (!verified) return NextResponse.json({ error: 'invalid_code' }, { status: 422 })

  try {
    const result = await createOrReturnSweepstakesEntry({
      campaign,
      name: body.name,
      email: body.email,
      locale: body.locale,
    })
    return NextResponse.json({
      ok: true,
      entry_id: result.entry.id,
      ticket_count: result.ticketCount,
    })
  } catch (e) {
    console.error('[sweepstakes] entry failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
