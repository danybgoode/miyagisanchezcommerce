/**
 * GET /api/promoter/validate-code?code=…&itemsCents=…
 *
 * Real-time promoter-discount preview at a paid-SKU checkout (Sprint 1). Resolves
 * the promoter code against the admin-set discount and returns what the seller
 * would save — BEFORE pay. No money moves here; the real charge + cadence is
 * Sprint 2. Mirrors app/api/checkout/validate-coupon's preview shape.
 *
 * Gated by the `promoter.enabled` flag (default off): when off, the feature is
 * hidden — the route 404s so nothing leaks before the program launches.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import {
  getPromoterByCode,
  getPromoterSettings,
  resolvePromoterDiscount,
  promoterRefusalMessage,
} from '@/lib/promoter'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ valid: false, message: 'No disponible.' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code') ?? ''
  const itemsCents = Math.max(0, Math.round(Number(searchParams.get('itemsCents') ?? '0')) || 0)

  if (!code.trim()) {
    return NextResponse.json({ valid: false, message: 'Escribe un código.' }, { status: 400 })
  }

  const promoter = await getPromoterByCode(code)
  const settings = await getPromoterSettings()
  const result = resolvePromoterDiscount({ promoter, settings, itemsCents })

  if (!result.ok) {
    return NextResponse.json({ valid: false, message: promoterRefusalMessage(result.reason) })
  }
  return NextResponse.json({
    valid: true,
    code: result.code,
    discount_cents: result.discount_cents,
  })
}
