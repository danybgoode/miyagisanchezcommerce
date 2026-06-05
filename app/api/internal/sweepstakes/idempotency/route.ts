import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import {
  awardSweepstakesPurchaseBonusForOrder,
  createOrReturnSweepstakesEntry,
  drawSweepstakesCampaign,
  uniqueSweepstakesSlug,
} from '@/lib/sweepstakes'
import type { SweepstakesCampaign } from '@/lib/sweepstakes-types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const configured = process.env.SWEEPSTAKES_IDEMPOTENCY_TEST_SECRET
  if (!configured) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.headers.get('x-sweepstakes-test-secret') !== configured) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .limit(1)
    .maybeSingle()

  if (!shop?.id) return NextResponse.json({ error: 'No shop available for test.' }, { status: 412 })

  const metadata = (shop.metadata ?? {}) as Record<string, unknown>
  const sellerId = String(metadata.medusa_seller_id ?? shop.id)
  const now = Date.now()
  const slug = await uniqueSweepstakesSlug(`idempotency-${now}`)

  const { data: campaign, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .insert({
      shop_id: shop.id,
      medusa_seller_id: sellerId,
      slug,
      status: 'active',
      title_es: 'Prueba de idempotencia',
      title_en: 'Idempotency test',
      prize_description_es: 'Temporal',
      prize_description_en: 'Temporary',
      terms_es: 'Temporal',
      terms_en: 'Temporary',
      starts_at: new Date(now - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(now + 60 * 60 * 1000).toISOString(),
      free_ticket_value: 1,
      purchase_bonus_enabled: true,
      purchase_ticket_value: 5,
      organizer_name: 'Miyagi Test',
      organizer_contact: 'test@miyagisanchez.com',
      permit_reference: 'TEST',
      compliance_attested_at: new Date().toISOString(),
      compliance_attested_by: 'internal-test',
      created_by: 'internal-test',
    })
    .select('*')
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaign test setup failed.' }, { status: 500 })

  try {
    const typed = campaign as SweepstakesCampaign
    const email = `sweepstakes-test-${now}@example.com`
    const { entry } = await createOrReturnSweepstakesEntry({
      campaign: typed,
      name: 'Test Entrant',
      email,
      locale: 'en',
    })

    const orderId = `order_sweepstakes_test_${now}`
    await awardSweepstakesPurchaseBonusForOrder({ sellerId, orderId, buyerEmail: email, paidAt: new Date().toISOString() })
    await awardSweepstakesPurchaseBonusForOrder({ sellerId, orderId, buyerEmail: email, paidAt: new Date().toISOString() })

    const { count: purchaseTickets } = await db
      .from('marketplace_sweepstakes_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', typed.id)
      .eq('entry_id', entry.id)
      .eq('source', 'purchase_bonus')
      .is('voided_at', null)

    await db.from('marketplace_sweepstakes_campaigns').update({
      ends_at: new Date(now - 60 * 1000).toISOString(),
      status: 'active',
    }).eq('id', typed.id)

    const firstDraw = await drawSweepstakesCampaign(typed.id, { notifyWinner: false })
    const secondDraw = await drawSweepstakesCampaign(typed.id, { notifyWinner: false })
    const { count: drawRows } = await db
      .from('marketplace_sweepstakes_draws')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', typed.id)

    return NextResponse.json({
      ok: true,
      purchase_ticket_rows: purchaseTickets ?? 0,
      expected_purchase_ticket_rows: typed.purchase_ticket_value,
      draw_rows: drawRows ?? 0,
      same_draw: !!firstDraw && !!secondDraw && firstDraw.id === secondDraw.id,
    })
  } finally {
    await db.from('marketplace_sweepstakes_campaigns').delete().eq('id', campaign.id)
  }
}
