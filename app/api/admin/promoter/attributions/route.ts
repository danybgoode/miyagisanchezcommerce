/**
 * GET /api/admin/promoter/attributions?promoterId=…
 *
 * A promoter's enrollment / attributed-sale ledger (admin console). Auth: Clerk
 * admin session (via withAdmin). Promoter Program · Sprint 1.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { listAttributions } from '@/lib/promoter'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (req: NextRequest) => {
  const promoterId = new URL(req.url).searchParams.get('promoterId') ?? ''
  if (!promoterId) return NextResponse.json({ error: 'promoterId requerido.' }, { status: 400 })
  const attributions = await listAttributions(promoterId)
  return NextResponse.json({ attributions })
})
