/**
 * GET /api/cron/print-pending  (daily)
 *
 * Two jobs for manual/SPEI print placements stuck at `pending_payment`:
 *   1. Remind the buyer once as the edition deadline nears (≤72h).
 *   2. Release the slot when the edition has closed / its deadline passed —
 *      flip to `rejected` (frees tier capacity; rejected is not an occupying status).
 *
 * Auth: x-cron-secret / ?secret= against CRON_SECRET (also accepts Vercel's
 * `Authorization: Bearer <CRON_SECRET>`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { sendPrintAdPaymentPending } from '@/lib/email'
import type { PrintEdition, PrintAdSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
const fmtMXN = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

const REMIND_WINDOW_MS = 72 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  const authz = req.headers.get('authorization')
  if (secret !== process.env.CRON_SECRET && authz !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows } = await db
    .from('print_ad_submissions')
    .select('*, print_editions(title, status, submission_deadline, distribution_date, tiers)')
    .eq('status', 'pending_payment')

  const subs = (rows ?? []) as Array<PrintAdSubmission & { print_editions?: (PrintEdition & object) | null }>
  const now = Date.now()
  let released = 0
  let reminded = 0

  for (const s of subs) {
    const ed = s.print_editions
    if (!ed) continue
    const deadline = ed.submission_deadline ? new Date(ed.submission_deadline).getTime() : null
    const editionClosed = ['closed', 'in_production', 'distributed'].includes(ed.status)
    const pastDeadline = deadline != null && now > deadline

    // 1. Release expired unpaid slots.
    if (editionClosed || pastDeadline) {
      await db.from('print_ad_submissions')
        .update({ status: 'rejected', admin_notes: 'Pago no recibido a tiempo — lugar liberado automáticamente.' })
        .eq('id', s.id)
      released++
      continue
    }

    // 2. One reminder as the deadline nears.
    if (deadline != null && deadline - now <= REMIND_WINDOW_MS && !s.content?.payment_reminded && s.buyer_email) {
      const tier = (ed.tiers ?? []).find((t) => t.key === s.tier_key)
      sendPrintAdPaymentPending({
        buyerEmail: s.buyer_email,
        editionTitle: ed.title ?? 'Edición impresa',
        tierLabel: tier?.label ?? s.tier_key,
        amountDue: tier ? fmtMXN(tier.price_cents) : '',
        manual: s.content?.manual_payment ?? {},
        submissionDeadline: ed.submission_deadline ?? null,
        manageUrl: `${SITE_URL}/account/print-ads`,
      }).catch(() => {})
      await db.from('print_ad_submissions')
        .update({ content: { ...(s.content ?? {}), payment_reminded: true } })
        .eq('id', s.id)
      reminded++
    }
  }

  return NextResponse.json({ ok: true, released, reminded, scanned: subs.length })
}
