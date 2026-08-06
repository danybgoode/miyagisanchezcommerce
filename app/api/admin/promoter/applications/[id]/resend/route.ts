import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getPromoterApplication } from '@/lib/promoter-applications'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { rotateAndResendFoundingOperatorInvitation } from '@/lib/founding-operator-activation'

export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export const POST = withAdmin(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!(await recruitingV3Enabled())) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const application = await getPromoterApplication(id)
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (application.program_track !== 'founding_operator'
    || application.status !== 'approved'
    || application.activation_used_at != null) {
    return NextResponse.json({ error: 'invalid_transition' }, { status: 409 })
  }

  const result = await rotateAndResendFoundingOperatorInvitation(id, SITE)
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404
      : result.reason === 'invalid_transition' ? 409 : 503
    return NextResponse.json({ error: result.reason }, { status })
  }
  // Rotation has committed even if the provider cannot confirm acceptance.
  // Keep this 2xx so withAdmin writes the audit row for the real mutation.
  return NextResponse.json({
    ok: true,
    application: result.application,
    invitation: { providerStatus: result.providerStatus, outcomeRecorded: result.outcomeRecorded },
  })
})
