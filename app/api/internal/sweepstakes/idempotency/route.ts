import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import {
  awardSweepstakesPurchaseBonusForOrder,
  createOrReturnSweepstakesEntry,
  drawSweepstakesCampaign,
  runSweepstakesDrawCron,
  sendSweepstakesConsolationBroadcast,
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
  const originalSettings = await db
    .from('marketplace_sweepstakes_settings')
    .select('enabled, disabled_reason')
    .eq('id', 1)
    .maybeSingle()
  let settingsChanged = false

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

  let incompleteCampaignId: string | null = null
  try {
    const typed = campaign as SweepstakesCampaign
    const incompleteSlug = await uniqueSweepstakesSlug(`missing-legal-${now}`)
    const { data: incomplete } = await db
      .from('marketplace_sweepstakes_campaigns')
      .insert({
        shop_id: shop.id,
        medusa_seller_id: sellerId,
        slug: incompleteSlug,
        status: 'draft',
        title_es: 'Sin permiso',
        title_en: 'Missing permit',
        prize_description_es: 'Temporal',
        prize_description_en: 'Temporary',
        terms_es: '',
        terms_en: '',
        created_by: 'internal-test',
      })
      .select('id')
      .single()
    incompleteCampaignId = incomplete?.id ?? null

    const legalBypass = incompleteCampaignId
      ? await db
          .from('marketplace_sweepstakes_campaigns')
          .update({ status: 'active' })
          .eq('id', incompleteCampaignId)
          .select('id')
      : { error: new Error('incomplete setup failed') }

    const email = `sweepstakes-test-${now}@example.com`
    const firstEntry = await createOrReturnSweepstakesEntry({
      campaign: typed,
      name: 'Test Entrant',
      email,
      locale: 'en',
    })
    const secondEntry = await createOrReturnSweepstakesEntry({
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
      .eq('entry_id', firstEntry.entry.id)
      .eq('source', 'purchase_bonus')
      .is('voided_at', null)

    await db.from('marketplace_sweepstakes_settings').upsert({
      id: 1,
      enabled: false,
      disabled_reason: 'internal idempotency smoke',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    settingsChanged = true

    const blockedOrderId = `order_sweepstakes_blocked_${now}`
    await awardSweepstakesPurchaseBonusForOrder({ sellerId, orderId: blockedOrderId, buyerEmail: email, paidAt: new Date().toISOString() })
    const { count: blockedPurchaseTickets } = await db
      .from('marketplace_sweepstakes_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', typed.id)
      .eq('entry_id', firstEntry.entry.id)
      .eq('source', 'purchase_bonus')
      .like('award_key', `purchase:${blockedOrderId}:%`)
      .is('voided_at', null)
    const disabledDraw = await runSweepstakesDrawCron()
    let disabledBroadcastBlocked = false
    try {
      await sendSweepstakesConsolationBroadcast({
        campaign: typed,
        messageEs: 'Bloqueado',
        messageEn: 'Blocked',
        createdBy: 'internal-test',
      })
    } catch {
      disabledBroadcastBlocked = true
    }

    const restore = originalSettings.data
      ? {
          id: 1,
          enabled: originalSettings.data.enabled !== false,
          disabled_reason: originalSettings.data.disabled_reason ?? null,
          updated_at: new Date().toISOString(),
        }
      : { id: 1, enabled: true, disabled_reason: null, updated_at: new Date().toISOString() }
    await db.from('marketplace_sweepstakes_settings').upsert(restore, { onConflict: 'id' })
    settingsChanged = false

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
      legal_gate_blocked: !!legalBypass.error,
      duplicate_free_entry_same_entry: firstEntry.entry.id === secondEntry.entry.id,
      duplicate_free_ticket_count: secondEntry.ticketCount,
      expected_free_ticket_count: typed.free_ticket_value,
      purchase_ticket_rows: purchaseTickets ?? 0,
      expected_purchase_ticket_rows: typed.purchase_ticket_value,
      kill_switch_blocked_purchase_rows: blockedPurchaseTickets ?? 0,
      kill_switch_blocked_draw: disabledDraw.disabled === true,
      kill_switch_blocked_broadcast: disabledBroadcastBlocked,
      draw_rows: drawRows ?? 0,
      same_draw: !!firstDraw && !!secondDraw && firstDraw.id === secondDraw.id,
    })
  } finally {
    if (settingsChanged) {
      const restore = originalSettings.data
        ? {
            id: 1,
            enabled: originalSettings.data.enabled !== false,
            disabled_reason: originalSettings.data.disabled_reason ?? null,
            updated_at: new Date().toISOString(),
          }
        : { id: 1, enabled: true, disabled_reason: null, updated_at: new Date().toISOString() }
      await db.from('marketplace_sweepstakes_settings').upsert(restore, { onConflict: 'id' })
    }
    if (incompleteCampaignId) {
      await db.from('marketplace_sweepstakes_campaigns').delete().eq('id', incompleteCampaignId)
    }
    await db.from('marketplace_sweepstakes_campaigns').delete().eq('id', campaign.id)
  }
}
