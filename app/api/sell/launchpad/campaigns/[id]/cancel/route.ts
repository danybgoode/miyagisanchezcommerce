/**
 * POST /api/sell/launchpad/campaigns/[id]/cancel — pull a draft/active campaign.
 *
 * Bookshop launchpad · Sprint 3.1. Terminal (cancelled). Clerk + shop-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { resolveCampaignSeller, cancelCampaign } from '@/lib/launchpad-campaigns'
import { campaignErrorMessage } from '../../route'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const result = await cancelCampaign(context, id)
  if (!result.ok) {
    return NextResponse.json({ error: campaignErrorMessage(result.error), reason: result.error }, { status: result.status })
  }
  return NextResponse.json({ campaign: result.campaign })
}
