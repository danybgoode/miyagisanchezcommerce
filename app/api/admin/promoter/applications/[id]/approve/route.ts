/**
 * POST /api/admin/promoter/applications/:id/approve
 *
 * Mints the applicant's PRM- code via the EXISTING createPromoter() (unchanged)
 * and emails it to them. Auth: Clerk admin session (via withAdmin).
 * Promoter Funnel v2 · Sprint 2 · US-2.2.
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { approvePromoterApplication, getPromoterApplication } from '@/lib/promoter-applications'
import { sendPromoterApplicationApproved } from '@/lib/email'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { approveAndInviteFoundingOperator } from '@/lib/founding-operator-activation'

export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export const POST = withAdmin(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const application = await getPromoterApplication(id)
  if (application?.program_track === 'founding_operator' && !(await recruitingV3Enabled())) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (application?.program_track === 'founding_operator') {
    const operatorResult = await approveAndInviteFoundingOperator(id, SITE)
    if (!operatorResult.ok) {
      const status = operatorResult.reason === 'not_found' ? 404
        : operatorResult.reason === 'invalid_transition' ? 409 : 503
      return NextResponse.json({ error: operatorResult.reason }, { status })
    }
    // Approval has already committed. A provider/outcome ambiguity is a 2xx
    // recoverable state so withAdmin records the successful admin mutation.
    return NextResponse.json({
      ok: true,
      application: operatorResult.application,
      invitation: {
        providerStatus: operatorResult.providerStatus,
        outcomeRecorded: operatorResult.outcomeRecorded,
      },
    })
  }
  const result = await approvePromoterApplication(id)
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: result.reason }, { status })
  }

  sendPromoterApplicationApproved({
    to: result.application.email,
    name: result.application.name,
    code: result.promoter!.code,
    bindUrl: `${SITE}/promotor/cerrar`,
  }).catch((e) => console.error('[promoter-applications] approved email failed:', e))

  return NextResponse.json({ ok: true, application: result.application, promoter: result.promoter })
})
