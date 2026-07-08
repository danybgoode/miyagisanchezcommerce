/**
 * POST /api/sell/launchpad/campaigns/[id]/activate — take a draft campaign live.
 *
 * Bookshop launchpad · Sprint 3.1. Runs the full activation gate (title, description,
 * threshold > 0, future end date, ≥1 work, reward = an owned CPP-configured product).
 * On a gate failure returns 422 + the `missing` list so the builder can point at it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { resolveCampaignSeller, activateCampaign } from '@/lib/launchpad-campaigns'
import { campaignErrorMessage } from '../../route'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const result = await activateCampaign(context, id)
  if (!result.ok) {
    return NextResponse.json(
      { error: campaignErrorMessage(result.error), reason: result.error, missing: result.missing ?? [] },
      { status: result.status },
    )
  }
  return NextResponse.json({ campaign: result.campaign })
}
