import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getCampaignStats } from '@/lib/sweepstakes'
import { getSellerSweepstakesCampaign } from '@/lib/sweepstakes-seller'

export const dynamic = 'force-dynamic'

const PATCH_FIELDS = [
  'title_es',
  'title_en',
  'prize_description_es',
  'prize_description_en',
  'prize_image_url',
  'terms_es',
  'terms_en',
  'starts_at',
  'ends_at',
  'free_ticket_value',
  'purchase_bonus_enabled',
  'purchase_ticket_value',
  'organizer_name',
  'organizer_contact',
  'permit_reference',
] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerSweepstakesCampaign(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  return NextResponse.json({ campaign: { ...found.campaign, stats: await getCampaignStats(id) } })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerSweepstakesCampaign(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (found.campaign.status === 'completed') {
    return NextResponse.json({ error: 'No se puede editar un sorteo completado.' }, { status: 422 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const field of PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const value = body[field]
    if (typeof value === 'string') patch[field] = value.trim() || null
    else if (typeof value === 'boolean') patch[field] = value
    else if (typeof value === 'number') patch[field] = value
    else if (value === null) patch[field] = null
  }
  if (typeof patch.free_ticket_value === 'number') {
    patch.free_ticket_value = Math.max(1, Math.min(100, Math.floor(patch.free_ticket_value)))
  }
  if (typeof patch.purchase_ticket_value === 'number') {
    patch.purchase_ticket_value = Math.max(1, Math.min(500, Math.floor(patch.purchase_ticket_value)))
  }

  const { data, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .update(patch)
    .eq('id', id)
    .eq('shop_id', found.context!.shop.id)
    .select('*')
    .single()

  if (error || !data) return NextResponse.json({ error: 'No se pudo actualizar el sorteo.' }, { status: 500 })
  return NextResponse.json({ campaign: { ...data, stats: await getCampaignStats(id) } })
}
