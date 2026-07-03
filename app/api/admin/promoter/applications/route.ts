/**
 * GET /api/admin/promoter/applications — pending/approved/rejected applications.
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Funnel v2 · Sprint 2 · US-2.2.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { listPromoterApplications, type PromoterApplication } from '@/lib/promoter-applications'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (req: NextRequest) => {
  const status = new URL(req.url).searchParams.get('status') as PromoterApplication['status'] | null
  const applications = await listPromoterApplications(status ?? undefined)
  return NextResponse.json({ applications })
})
