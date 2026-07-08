/**
 * POST /api/launchpad/campaigns/[slug]/verification — send a 6-char email code to
 * a reader about to vote. No account required — the email code IS the identity
 * check (bookshop-launchpad S3.2). rate-limit → flag → campaign open → send.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getCampaignBySlug, sendCampaignVoteCode, isValidEmail } from '@/lib/launchpad-campaigns'
import { campaignAcceptsVotes } from '@/lib/launchpad-campaign-types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const rl = await checkRateLimit('launchpad_vote', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }

  const { slug } = await params
  const campaign = await getCampaignBySlug(slug)
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!campaignAcceptsVotes(campaign)) return NextResponse.json({ error: 'not_open' }, { status: 422 })

  let body: { email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }
  if (!body.email || !isValidEmail(body.email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  try {
    await sendCampaignVoteCode(campaign, body.email)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[launchpad-campaign] verification send failed:', e)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
