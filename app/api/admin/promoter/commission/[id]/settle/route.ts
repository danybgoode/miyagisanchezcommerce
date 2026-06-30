/**
 * POST /api/admin/promoter/commission/[id]/settle — mark a commission paid (offline).
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Program · Sprint 3 (US-9).
 * Records that the admin settled in cash/transfer — NO in-app money moves, no Stripe
 * transfer. Idempotent: re-settling an already-paid commission is a no-op that
 * still returns ok (settleCommission claims atomically on status='accrued').
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { settleCommission } from '@/lib/promoter'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { reference?: string } = {}
  try { body = await req.json() } catch { /* reference is optional */ }

  const reference = typeof body.reference === 'string' ? body.reference.trim() || null : null
  const { ok, alreadyPaid } = await settleCommission(id, reference)
  if (!ok) return NextResponse.json({ error: 'No se pudo marcar como pagada.' }, { status: 502 })
  return NextResponse.json({ ok: true, alreadyPaid })
})
