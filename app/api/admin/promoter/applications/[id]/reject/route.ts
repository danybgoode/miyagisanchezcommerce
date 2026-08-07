/**
 * POST /api/admin/promoter/applications/:id/reject
 *
 * No code is minted on this path. Auth: Clerk admin session (via withAdmin).
 * Promoter Funnel v2 · Sprint 2 · US-2.2.
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getPromoterApplication, rejectPromoterApplication } from '@/lib/promoter-applications'
import { sendFoundingOperatorApplicationRejected, sendPromoterApplicationRejected } from '@/lib/email'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const application = await getPromoterApplication(id)
  if (application?.program_track === 'founding_operator' && !(await recruitingV3Enabled())) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const result = await rejectPromoterApplication(id)
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: result.reason }, { status })
  }

  const sendRejection = result.application.program_track === 'founding_operator'
    ? sendFoundingOperatorApplicationRejected
    : sendPromoterApplicationRejected
  sendRejection({ to: result.application.email, name: result.application.name })
    .catch((e) => console.error('[promoter-applications] rejected email failed:', e))

  return NextResponse.json({ ok: true, application: result.application })
})
