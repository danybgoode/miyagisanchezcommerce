/**
 * GET   /api/admin/promoter/commission  — per-SKU commission rates
 * PATCH /api/admin/promoter/commission  — set one SKU's commission % ({ sku, rate_pct })
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Program · Sprint 3 (US-7).
 * No deploy needed to tune the economics — mirrors the referral/discount settings.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getCommissionRates, updateCommissionRate, isPromoterSku } from '@/lib/promoter'
import { isValidRatePct } from '@/lib/promoter-commission'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const rates = await getCommissionRates()
  return NextResponse.json({ rates })
})

export const PATCH = withAdmin(async (req: NextRequest) => {
  let body: { sku?: string; rate_pct?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!isPromoterSku(body.sku) || !isValidRatePct(body.rate_pct)) {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const { ok } = await updateCommissionRate(body.sku, body.rate_pct)
  if (!ok) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 502 })

  const rates = await getCommissionRates()
  return NextResponse.json({ rates })
})
