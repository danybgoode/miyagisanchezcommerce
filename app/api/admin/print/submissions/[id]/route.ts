/**
 * PATCH /api/admin/print/submissions/[id]  (Clerk admin-gated via withAdmin)
 * Update a submission's editorial status (approve / reject / placed / refunded)
 * and/or admin_notes. Used by the admin review queue.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { sendPrintAdPaidEmails, sendPrintAdLifecycleEmail } from '@/lib/print-server'
import { withAdmin } from '@/lib/admin/guard'
import { markAttributionPaid } from '@/lib/promoter'
import type { PrintSubmissionStatus, PrintAdSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

const ADMIN_STATUSES: PrintSubmissionStatus[] = [
  'pending_payment', 'paid', 'approved', 'placed', 'rejected', 'refunded',
]

export const PATCH = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { status?: PrintSubmissionStatus; admin_notes?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (body.status) {
    if (!ADMIN_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = body.status
  }
  if (typeof body.admin_notes === 'string') patch.admin_notes = body.admin_notes
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  // Read prior status to detect the manual-payment reconciliation transition.
  const { data: prior } = await db.from('print_ad_submissions').select('status').eq('id', id).single()

  const { data, error } = await db.from('print_ad_submissions').update(patch).eq('id', id).select('*').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })

  // Manual/SPEI placements never hit a payment webhook — when the owner confirms
  // payment here (pending_payment → paid), fire the same emails the card flow sends.
  if (body.status === 'paid' && prior?.status === 'pending_payment') {
    await sendPrintAdPaidEmails(data as PrintAdSubmission, {})

    // Promoter Program (epic 08 · S4): a cash-reported / manual print ad sold by a
    // promoter never reached the card webhook, so accrue its commission HERE on the
    // offline confirm — same as handlePrintAdPaid does for card. Idempotent.
    const content = ((data as PrintAdSubmission).content ?? {}) as Record<string, unknown>
    const promoterId = typeof content.promoter_id === 'string' ? content.promoter_id : null
    const promoterSellerId = typeof content.promoter_seller_id === 'string' ? content.promoter_seller_id : null
    if (promoterId && promoterSellerId) {
      const tier = await db
        .from('print_editions')
        .select('tiers')
        .eq('id', (data as PrintAdSubmission).edition_id)
        .single()
        .then(({ data: ed }) => (ed?.tiers ?? []).find((t: { key: string }) => t.key === (data as PrintAdSubmission).tier_key))
      await markAttributionPaid({
        promoterId,
        sellerId: promoterSellerId,
        sku: 'print_ad',
        grossAmountCents: tier?.price_cents ?? 0,
        cadence: 'one_time',
      })
    }
  }
  // Editorial lifecycle emails (only on the transition into the status).
  if (body.status === 'approved' && prior?.status !== 'approved') {
    await sendPrintAdLifecycleEmail(data as PrintAdSubmission, 'approved')
  }
  if (body.status === 'rejected' && prior?.status !== 'rejected') {
    await sendPrintAdLifecycleEmail(data as PrintAdSubmission, 'rejected')
  }

  return NextResponse.json({ submission: data })
})
