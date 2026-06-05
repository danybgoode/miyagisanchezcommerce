import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getSweepstakesSettings, validatePublishGate } from '@/lib/sweepstakes'
import { getSellerSweepstakesCampaign } from '@/lib/sweepstakes-seller'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerSweepstakesCampaign(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  const settings = await getSweepstakesSettings()
  if (!settings.enabled) {
    return NextResponse.json({ error: 'sweepstakes_disabled', reason: settings.disabled_reason }, { status: 423 })
  }

  let body: { attested?: boolean }
  try { body = await req.json() } catch { body = {} }

  const missing = validatePublishGate({ ...found.campaign, attested: body.attested === true })
  if (missing.length > 0) {
    return NextResponse.json({ error: 'publish_gate', missing }, { status: 422 })
  }

  const now = Date.now()
  const startsAt = new Date(found.campaign.starts_at!).getTime()
  const nextStatus = startsAt > now ? 'scheduled' : 'active'

  const { data, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .update({
      status: nextStatus,
      compliance_attested_at: new Date().toISOString(),
      compliance_attested_by: found.context!.userId,
    })
    .eq('id', id)
    .eq('shop_id', found.context!.shop.id)
    .select('*')
    .single()

  if (error || !data) {
    console.error('[sweepstakes] publish failed:', error)
    return NextResponse.json({ error: 'No se pudo publicar el sorteo.' }, { status: 500 })
  }

  return NextResponse.json({ campaign: data })
}
