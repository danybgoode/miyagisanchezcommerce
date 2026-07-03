/**
 * GET /api/admin/print/studio/social?editionId=…  (`withPrintStudio`)
 * Approved + placed social/editorial submissions, for zine's social section
 * (Story 2.3). `placed` is included for the same reason
 * `studio/editions/[id]/submissions` includes it: so zine can also show —
 * and un-place — a submission it already placed, instead of it vanishing
 * from the list on the next fetch.
 *
 * `editionId` scoping is asymmetric by design, and the two statuses must
 * NOT share one OR-clause: an `approved` row is offerable to any edition
 * while `edition_id IS NULL` (not yet assigned), but a `placed` row is
 * physically inside ONE booklet — the write-back route always sets
 * `edition_id` when placing (see `studio/social/[id]`), so a bare
 * `edition_id.is.null` branch would leak an unassigned placed row (a bug,
 * were one to exist) into every edition's queue. So: approved matches this
 * edition OR unassigned; placed matches ONLY this edition. Omitted
 * `editionId` returns every approved/placed item, unscoped. PII-safe
 * projection (submitter email/Clerk id stripped), same discipline as the
 * ad-submission studio routes.
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

  let query = db.from('print_social_submissions').select('*')
  if (editionId) {
    // editionId is UUID-validated above, so it's safe to interpolate into
    // the PostgREST .or()/.and() filter strings (no parameterized form).
    query = query.or(
      `and(status.eq.approved,edition_id.eq.${editionId}),` +
        `and(status.eq.approved,edition_id.is.null),` +
        `and(status.eq.placed,edition_id.eq.${editionId})`,
    )
  } else {
    query = query.in('status', ['approved', 'placed'])
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const submissions = ((data ?? []) as PrintSocialSubmission[]).map(toStudioSafeSocialSubmission)
  return NextResponse.json({ submissions })
})
