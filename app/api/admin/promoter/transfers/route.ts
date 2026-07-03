/**
 * GET /api/admin/promoter/transfers — pending (reported) net-remittance transfers,
 * oldest first, for the "Transferencias pendientes" admin review section.
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Funnel v2 · Sprint 4 (US-4.2).
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { listReportedPromoterTransfers } from '@/lib/promoter-transfers'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const transfers = await listReportedPromoterTransfers()
  return NextResponse.json({ transfers })
})
