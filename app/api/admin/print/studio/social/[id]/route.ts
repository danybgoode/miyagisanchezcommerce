/**
 * PATCH /api/admin/print/studio/social/[id]  (`withPrintStudio`)
 * The ONE mutation the zine studio may make on a social submission: flip
 * `approved ⇄ placed` when it places/un-places one in a booklet's community
 * section (Story 2.3). Mirrors `studio/submissions/[id]` exactly — 400s on
 * any other target status, 409s if the submission's current status isn't
 * the expected source of the transition. Every other social-submission
 * mutation (assigning an edition, curating, rejecting) stays exclusively on
 * the Clerk-only `/api/admin/print/social/[id]` route.
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

export const PATCH = withPrintStudio(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { status?: PrintSocialStatus }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.status || !STUDIO_SOCIAL_TARGET_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'status must be approved or placed' }, { status: 400 })
  }

  const { data: prior, error: priorError } = await db
    .from('print_social_submissions')
    .select('status')
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

  const { data, error } = await db
    .from('print_social_submissions')
    .update({ status: body.status })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })

  return NextResponse.json({ submission: toStudioSafeSocialSubmission(data as PrintSocialSubmission) })
})
