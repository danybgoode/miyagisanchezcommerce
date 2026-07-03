/**
 * POST /api/admin/promoter/applications/:id/approve
 *
 * Mints the applicant's PRM- code via the EXISTING createPromoter() (unchanged)
 * and emails it to them. Auth: Clerk admin session (via withAdmin).
 * Promoter Funnel v2 · Sprint 2 · US-2.2.
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { approvePromoterApplication } from '@/lib/promoter-applications'
import { sendPromoterApplicationApproved } from '@/lib/email'

export const dynamic = 'force-dynamic'

const SITE = 'https://miyagisanchez.com'

export const POST = withAdmin(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
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
