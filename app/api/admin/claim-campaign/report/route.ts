import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'

/** Durable first-party counts; Resend/Golden delivery metrics remain in their tools. */
export const GET = withAdmin<NextRequest>(async (req) => {
  const campaignId = req.nextUrl.searchParams.get('campaignId') ?? ''
  if (!/^[a-z0-9-]{1,80}$/.test(campaignId)) {
    return NextResponse.json({ error: 'Campaña inválida.' }, { status: 400 })
  }
  const [issued, claimed, removal] = await Promise.all([
    db.from('claim_campaign_invitations').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId),
    db.from('claim_campaign_invitations').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).not('claimed_at', 'is', null),
    db.from('claim_campaign_invitations').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).not('removal_requested_at', 'is', null),
  ])
  if (issued.error || claimed.error || removal.error || issued.count === null || claimed.count === null || removal.count === null) {
    return NextResponse.json({ error: 'Las métricas no están disponibles.' }, { status: 503 })
  }
  return NextResponse.json({ campaignId, issued: issued.count, claimed: claimed.count, removalRequested: removal.count })
})
