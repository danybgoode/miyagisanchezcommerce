/**
 * PATCH /api/admin/print/studio/social/[id]  (`withPrintStudio`)
 * The ONE mutation the zine studio may make on a social submission: flip
 * `approved ⇄ placed` when it places/un-places one in a booklet's community
 * section (Story 2.3). Mirrors `studio/submissions/[id]` exactly — 400s on
 * any other target status, 409s if the submission's current status isn't
 * the expected source of the transition. Every other social-submission
 * mutation (assigning an edition, curating, rejecting) stays exclusively on
 * the Clerk-only `/api/admin/print/social/[id]` route.
 *
 * `editionId` is REQUIRED when placing (and ignored when un-placing): a
 * `placed` row with no `edition_id` is ambiguous about which booklet it's
 * physically in, and `studio/social` GET's edition-scoping treats any
 * `edition_id IS NULL` row as visible to every edition — leaving a placed
 * submission unassigned would leak it into every other edition's queue
 * (caught by a cross-review pass, not shipped this way). Un-placing
 * deliberately does NOT clear `edition_id` — that's an edition
 * *reassignment*, which stays on the Clerk-only route — and placing may
 * only ASSIGN an unassigned row, never REASSIGN an already-assigned one to
 * a different edition (also cross-review-caught): the update itself is
 * additionally guarded on `edition_id` being null or already matching.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import {
  isValidStudioSocialTransition,
  STUDIO_SOCIAL_TARGET_STATUSES,
  toStudioSafeSocialSubmission,
  type PrintSocialStatus,
  type PrintSocialSubmission,
} from '@/lib/print'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PATCH = withPrintStudio(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
  }
  let body: { status?: PrintSocialStatus; editionId?: string }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = parsed as { status?: PrintSocialStatus; editionId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.status || !STUDIO_SOCIAL_TARGET_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'status must be approved or placed' }, { status: 400 })
  }
  if (body.status === 'placed' && (!body.editionId || !UUID_RE.test(body.editionId))) {
    return NextResponse.json({ error: 'editionId (UUID) is required to place a social submission' }, { status: 400 })
  }

  const { data: prior, error: priorError } = await db
    .from('print_social_submissions')
    .select('status, edition_id')
    .eq('id', id)
    .maybeSingle()
  if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 })
  if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isValidStudioSocialTransition(prior.status as PrintSocialStatus, body.status)) {
    return NextResponse.json(
      { error: `Cannot go from ${prior.status} to ${body.status}` },
      { status: 409 },
    )
  }
  // Placing may only ASSIGN an unassigned row, never REASSIGN one already
  // tied to a different edition — reassignment is the Clerk-only route's
  // job, not this narrow status-flip's.
  if (body.status === 'placed' && prior.edition_id && prior.edition_id !== body.editionId) {
    return NextResponse.json(
      { error: 'Submission is already assigned to a different edition.' },
      { status: 409 },
    )
  }

  const update: { status: PrintSocialStatus; edition_id?: string } = { status: body.status }
  if (body.status === 'placed') update.edition_id = body.editionId

  // Guard the update on the status AND edition_id we just read, so a
  // concurrent flip/reassignment between the read above and this write
  // can't silently apply on top of a state it never actually validated
  // against (0 rows updated = lost the race → 409, not a false success).
  let query = db.from('print_social_submissions').update(update).eq('id', id).eq('status', prior.status)
  query = prior.edition_id ? query.eq('edition_id', prior.edition_id) : query.is('edition_id', null)
  const { data, error } = await query.select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json({ error: 'Submission changed concurrently — retry.' }, { status: 409 })
  }

  return NextResponse.json({ submission: toStudioSafeSocialSubmission(data as PrintSocialSubmission) })
})
