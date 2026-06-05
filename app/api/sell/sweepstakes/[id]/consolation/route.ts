import { NextRequest, NextResponse } from 'next/server'
import { sendSweepstakesConsolationBroadcast } from '@/lib/sweepstakes'
import { getSellerSweepstakesCampaign } from '@/lib/sweepstakes-seller'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerSweepstakesCampaign(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (found.campaign.status !== 'completed') {
    return NextResponse.json({ error: 'El sorteo aun no esta completado.' }, { status: 422 })
  }

  let body: { message_es?: string; message_en?: string; coupon_code?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const messageEs = body.message_es?.trim() ?? ''
  const messageEn = body.message_en?.trim() ?? ''
  if (!messageEs || !messageEn) return NextResponse.json({ error: 'message_es y message_en son requeridos.' }, { status: 422 })

  try {
    const result = await sendSweepstakesConsolationBroadcast({
      campaign: found.campaign,
      messageEs,
      messageEn,
      couponCode: body.coupon_code?.trim() || null,
      createdBy: found.context!.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    return NextResponse.json({ error: msg === 'disabled' ? 'sweepstakes_disabled' : 'No se pudo enviar el mensaje.' }, { status: msg === 'disabled' ? 423 : 500 })
  }
}
