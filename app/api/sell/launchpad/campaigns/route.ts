/**
 * GET  /api/sell/launchpad/campaigns — list this shop's voting campaigns (+ works + vote count)
 * POST /api/sell/launchpad/campaigns — create a DRAFT campaign
 *
 * Bookshop launchpad · Sprint 3.1. Clerk-authenticated + shop-scoped. Gated on
 * `launchpad.enabled` (fail-safe OFF). Commerce stays in Medusa; the campaign +
 * votes are non-commerce intake data (Supabase, AGENTS rule #2).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { resolveCampaignSeller, listCampaignsForShop, createCampaign } from '@/lib/launchpad-campaigns'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const campaigns = await listCampaignsForShop(context.shop.id)
  return NextResponse.json({ campaigns })
}

export async function POST(req: NextRequest) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: {
    title?: string
    description?: string | null
    terms?: string | null
    vote_threshold?: number
    ends_at?: string | null
    reward_percent?: number | null
    reward_product_id?: string | null
    work_product_ids?: string[]
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'El título es obligatorio.' }, { status: 422 })
  }

  const result = await createCampaign({
    context,
    title: body.title,
    description: body.description ?? null,
    terms: body.terms ?? null,
    vote_threshold: Number(body.vote_threshold ?? 0),
    ends_at: body.ends_at ?? null,
    reward_percent: body.reward_percent ?? null,
    reward_product_id: body.reward_product_id ?? null,
    work_product_ids: body.work_product_ids ?? [],
  })
  if (!result.ok) {
    return NextResponse.json({ error: campaignErrorMessage(result.error), reason: result.error }, { status: result.status })
  }
  return NextResponse.json({ campaign: result.campaign }, { status: 201 })
}

/** es-MX message for a campaign write failure reason. Exported for the [id] route. */
export function campaignErrorMessage(reason: string): string {
  switch (reason) {
    case 'work_not_owned': return 'Una de las obras seleccionadas no pertenece a tu tienda.'
    case 'reward_not_owned': return 'El producto de recompensa no pertenece a tu tienda.'
    case 'reward_not_configurable': return 'La recompensa debe ser un producto de impresión configurable (tamaño/encuadernación o precios por cantidad).'
    case 'not_found': return 'Campaña no encontrada.'
    case 'not_editable': return 'Solo se pueden editar campañas en borrador.'
    case 'invalid_transition': return 'Esta acción no es válida para el estado actual de la campaña.'
    case 'incomplete': return 'Faltan datos para activar la campaña.'
    case 'title_required': return 'El título es obligatorio.'
    default: return 'No se pudo guardar la campaña.'
  }
}
