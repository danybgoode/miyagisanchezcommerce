/**
 * GET /api/admin/print/studio/social?editionId=…  (`withPrintStudio`)
 * Approved social/editorial submissions, for zine's social section (Story
 * 2.3). `editionId` is optional — when given, returns items assigned to
 * that edition PLUS approved-but-unassigned ones (a social item can be
 * approved before an edition exists to place it in); omitted, returns every
 * approved item. PII-safe projection (submitter email/Clerk id stripped),
 * same discipline as the ad-submission studio routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import { toStudioSafeSocialSubmission, type PrintSocialSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withPrintStudio(async (req: NextRequest) => {
  const editionId = req.nextUrl.searchParams.get('editionId')
  if (editionId && !UUID_RE.test(editionId)) {
    return NextResponse.json({ error: 'editionId must be a UUID' }, { status: 400 })
  }

  let query = db.from('print_social_submissions').select('*').eq('status', 'approved')
  if (editionId) {
    // editionId is UUID-validated above, so it's safe to interpolate into
    // the PostgREST .or() filter string (which has no parameterized form).
    query = query.or(`edition_id.eq.${editionId},edition_id.is.null`)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const submissions = ((data ?? []) as PrintSocialSubmission[]).map(toStudioSafeSocialSubmission)
  return NextResponse.json({ submissions })
})
