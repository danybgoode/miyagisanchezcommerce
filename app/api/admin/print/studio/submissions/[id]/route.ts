/**
 * PATCH /api/admin/print/studio/submissions/[id]  (`withPrintStudio`)
 * The ONE mutation the zine studio may make: flip a submission `approved ⇄
 * placed` when it places/un-places an ad in a booklet slot (Story 1.2). Every
 * other status transition — including anything reachable from `paid` or
 * `refunded` — stays exclusively on the Clerk-only `/api/admin/print/submissions/[id]`
 * route; this endpoint 400s on any other target status, and 409s if the
 * submission's current status isn't the expected source of the transition.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import { isValidStudioTransition, type PrintSubmissionStatus } from '@/lib/print'

export const dynamic = 'force-dynamic'

const STUDIO_TARGET_STATUSES: PrintSubmissionStatus[] = ['approved', 'placed']

export const PATCH = withPrintStudio(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { status?: PrintSubmissionStatus }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.status || !STUDIO_TARGET_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'status must be approved or placed' }, { status: 400 })
  }

  const { data: prior, error: priorError } = await db
    .from('print_ad_submissions')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 })
  if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isValidStudioTransition(prior.status as PrintSubmissionStatus, body.status)) {
    return NextResponse.json(
      { error: `Cannot go from ${prior.status} to ${body.status}` },
      { status: 409 },
    )
  }

  const { data, error } = await db
    .from('print_ad_submissions')
    .update({ status: body.status })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })

  return NextResponse.json({ submission: data })
})
