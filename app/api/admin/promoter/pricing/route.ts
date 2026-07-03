/**
 * GET   /api/admin/promoter/pricing  — per-SKU promoter price overrides
 * PATCH /api/admin/promoter/pricing  — set one SKU's promoter price
 *   ({ sku, promoter_price_mxn: number | null })
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Funnel v2 · Sprint 3 (US-3.1).
 * `promoter_price_mxn: null` clears the override back to the legacy global
 * discount formula. No deploy needed — mirrors the commission-rate route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getPromoterSkuPrices, updatePromoterSkuPrice, isPromoterSku } from '@/lib/promoter'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const prices = await getPromoterSkuPrices()
  return NextResponse.json({ prices })
})

export const PATCH = withAdmin(async (req: NextRequest) => {
  let body: { sku?: string; promoter_price_mxn?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!isPromoterSku(body.sku)) {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  let promoterPriceMxn: number | null = null
  if (body.promoter_price_mxn !== null) {
    if (!Number.isFinite(body.promoter_price_mxn) || (body.promoter_price_mxn as number) < 0) {
      return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
    }
    promoterPriceMxn = Math.round(body.promoter_price_mxn as number)
  }

  const { ok } = await updatePromoterSkuPrice(body.sku, promoterPriceMxn)
  if (!ok) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 502 })

  const prices = await getPromoterSkuPrices()
  return NextResponse.json({ prices })
})
