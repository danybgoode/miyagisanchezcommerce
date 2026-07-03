/**
 * POST /api/admin/promoter/applications/:id/reject
 *
 * No code is minted on this path. Auth: Clerk admin session (via withAdmin).
 * Promoter Funnel v2 · Sprint 2 · US-2.2.
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { rejectPromoterApplication } from '@/lib/promoter-applications'
import { sendPromoterApplicationRejected } from '@/lib/email'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const result = await rejectPromoterApplication(id)
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: result.reason }, { status })
  }

  sendPromoterApplicationRejected({
    to: result.application.email,
    name: result.application.name,
  }).catch((e) => console.error('[promoter-applications] rejected email failed:', e))

  return NextResponse.json({ ok: true, application: result.application })
})
