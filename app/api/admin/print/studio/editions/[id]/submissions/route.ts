/**
 * GET /api/admin/print/studio/editions/[id]/submissions  (`withPrintStudio`)
 * An edition's paid/approved/placed ad submissions, for zine's paid-ads drawer
 * (Story 1.2). `placed` is included so zine can also show — and un-place — a
 * submission it already placed.
 *
 * Returns `PrintStudioSafeSubmission` — layout fields only. A bearer token is
 * weaker assurance than a Clerk admin session, so buyer PII (email, Clerk id)
 * and payment details (SPEI CLABE/bank/phone) never leave this route, even
 * though the underlying row carries them (see `toStudioSafeSubmission`).
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import { toStudioSafeSubmission, type PrintAdSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

export const GET = withPrintStudio(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { data, error } = await db
    .from('print_ad_submissions')
    .select('id, edition_id, tier_key, status, content, created_at')
    .eq('edition_id', id)
    .in('status', ['paid', 'approved', 'placed'])
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const submissions = (data ?? []).map((row) => toStudioSafeSubmission(row as PrintAdSubmission))
  return NextResponse.json({ submissions })
})
