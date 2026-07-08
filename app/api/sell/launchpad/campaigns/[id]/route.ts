/**
 * GET   /api/sell/launchpad/campaigns/[id] — one campaign (shop-scoped)
 * PATCH /api/sell/launchpad/campaigns/[id] — edit a DRAFT campaign (+ works)
 *
 * Bookshop launchpad · Sprint 3.1. Clerk + shop-scoped. Gated on `launchpad.enabled`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { resolveCampaignSeller, getCampaignForShop, updateCampaign } from '@/lib/launchpad-campaigns'
import { campaignErrorMessage } from '../route'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const campaign = await getCampaignForShop(context.shop.id, id)
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada.' }, { status: 404 })
  return NextResponse.json({ campaign })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const result = await updateCampaign(context, id, {
    title: body.title as string | undefined,
    description: body.description as string | null | undefined,
    terms: body.terms as string | null | undefined,
    vote_threshold: body.vote_threshold as number | undefined,
    ends_at: body.ends_at as string | null | undefined,
    reward_percent: body.reward_percent as number | null | undefined,
    reward_product_id: body.reward_product_id as string | null | undefined,
    work_product_ids: body.work_product_ids as string[] | undefined,
  })
  if (!result.ok) {
    return NextResponse.json({ error: campaignErrorMessage(result.error), reason: result.error }, { status: result.status })
  }
  return NextResponse.json({ campaign: result.campaign })
}
