/**
 * POST /api/launchpad/campaigns/[slug]/vote — record one email-verified vote for a
 * work in a campaign (bookshop-launchpad S3.2). One vote per email per work
 * (idempotent). rate-limit → flag → verify code → insert vote → return honest
 * progress. When the vote takes the campaign to its threshold, the reward mint is
 * fired idempotently (Story 3.3).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getCampaignBySlug, castVote } from '@/lib/launchpad-campaigns'

export const dynamic = 'force-dynamic'

const VOTE_ERROR_MESSAGE: Record<string, string> = {
  not_open: 'Esta campaña ya no está recibiendo votos.',
  invalid_email: 'Escribe un correo válido.',
  unknown_work: 'Esa obra no forma parte de esta campaña.',
  invalid_code: 'El código no es válido o ya expiró. Solicita uno nuevo.',
  vote_failed: 'No se pudo registrar tu voto. Inténtalo de nuevo.',
}

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

  let body: { work_product_id?: string; email?: string; code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'missing_fields' }, { status: 400 }) }
  if (!body.work_product_id?.trim() || !body.email?.trim() || !body.code?.trim()) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 422 })
  }

  const result = await castVote({
    campaign,
    workProductId: body.work_product_id,
    email: body.email,
    code: body.code,
  })
  if (!result.ok) {
    return NextResponse.json({ error: VOTE_ERROR_MESSAGE[result.error] ?? 'No se pudo registrar tu voto.', reason: result.error }, { status: result.status })
  }

  // NOTE: when `threshold_reached`, Story 3.3 fires the reward mint here
  // (idempotent, best-effort). Wired in with the automation module.

  return NextResponse.json({
    ok: true,
    already_voted: result.already_voted,
    vote_count: result.vote_count,
    threshold: campaign.vote_threshold,
    threshold_reached: result.threshold_reached,
  })
}
