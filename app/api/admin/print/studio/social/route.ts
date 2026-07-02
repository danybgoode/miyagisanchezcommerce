/**
 * GET /api/admin/print/studio/social  (`withPrintStudio`)
 * Approved social/editorial submissions, for zine's social section (pulled in
 * Sprint 2's 2.3 — read-only here so the surface exists ahead of that story,
 * per the epic's Story 1.2 scope).
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import type { PrintSocialSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

export const GET = withPrintStudio(async () => {
  const { data, error } = await db
    .from('print_social_submissions')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ submissions: (data ?? []) as PrintSocialSubmission[] })
})
