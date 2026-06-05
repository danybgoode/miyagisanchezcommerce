import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getSweepstakesSettings, getCampaignStats, uniqueSweepstakesSlug } from '@/lib/sweepstakes'
import { resolveSweepstakesSeller } from '@/lib/sweepstakes-seller'

export const dynamic = 'force-dynamic'

type CampaignPayload = {
  title_es?: string
  title_en?: string
  prize_description_es?: string
  prize_description_en?: string
  prize_image_url?: string | null
  terms_es?: string
  terms_en?: string
  starts_at?: string | null
  ends_at?: string | null
  free_ticket_value?: number
  purchase_bonus_enabled?: boolean
  purchase_ticket_value?: number
  organizer_name?: string
  organizer_contact?: string
  permit_reference?: string
}

function clean(body: CampaignPayload) {
  return {
    title_es: body.title_es?.trim() || null,
    title_en: body.title_en?.trim() || null,
    prize_description_es: body.prize_description_es?.trim() || null,
    prize_description_en: body.prize_description_en?.trim() || null,
    prize_image_url: body.prize_image_url?.trim() || null,
    terms_es: body.terms_es?.trim() || null,
    terms_en: body.terms_en?.trim() || null,
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
    free_ticket_value: Math.max(1, Math.min(100, Math.floor(Number(body.free_ticket_value ?? 1)))),
    purchase_bonus_enabled: body.purchase_bonus_enabled === true,
    purchase_ticket_value: Math.max(1, Math.min(500, Math.floor(Number(body.purchase_ticket_value ?? 5)))),
    organizer_name: body.organizer_name?.trim() || null,
    organizer_contact: body.organizer_contact?.trim() || null,
    permit_reference: body.permit_reference?.trim() || null,
  }
}

export async function GET() {
  const context = await resolveSweepstakesSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const [{ data: campaigns, error }, settings] = await Promise.all([
    db
      .from('marketplace_sweepstakes_campaigns')
      .select('*')
      .eq('shop_id', context.shop.id)
      .order('created_at', { ascending: false }),
    getSweepstakesSettings(),
  ])

  if (error) return NextResponse.json({ error: 'No se pudieron cargar los sorteos.' }, { status: 500 })
  const withStats = await Promise.all((campaigns ?? []).map(async (campaign) => ({
    ...campaign,
    stats: await getCampaignStats(campaign.id),
  })))

  return NextResponse.json({ campaigns: withStats, settings })
}

export async function POST(req: NextRequest) {
  const context = await resolveSweepstakesSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: CampaignPayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const payload = clean(body)
  const titleForSlug = payload.title_es || payload.title_en || 'sorteo'
  const slug = await uniqueSweepstakesSlug(titleForSlug)

  const { data, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .insert({
      ...payload,
      slug,
      shop_id: context.shop.id,
      medusa_seller_id: context.seller.id,
      created_by: context.userId,
      status: 'draft',
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[sweepstakes] create failed:', error)
    return NextResponse.json({ error: 'No se pudo crear el sorteo.' }, { status: 500 })
  }

  return NextResponse.json({ campaign: { ...data, stats: await getCampaignStats(data.id) } }, { status: 201 })
}
