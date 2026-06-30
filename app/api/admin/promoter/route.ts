/**
 * GET   /api/admin/promoter  — promoters + discount settings
 * POST  /api/admin/promoter  — provision a new promoter (admin, v1 — no self-serve)
 * PATCH /api/admin/promoter  — update the discount settings (no deploy needed)
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Program · Sprint 1.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import {
  createPromoter,
  listPromoters,
  getPromoterSettings,
  updatePromoterSettings,
  type PromoterSettings,
} from '@/lib/promoter'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const [promoters, settings] = await Promise.all([listPromoters(), getPromoterSettings()])
  return NextResponse.json({ promoters, settings })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: { name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const promoter = await createPromoter(typeof body.name === 'string' ? body.name : null)
  if (!promoter) return NextResponse.json({ error: 'No se pudo crear el promotor.' }, { status: 502 })
  return NextResponse.json({ promoter }, { status: 201 })
})

export const PATCH = withAdmin(async (req: NextRequest) => {
  let body: Partial<PromoterSettings>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const patch: Partial<PromoterSettings> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.discount_type === 'fixed' || body.discount_type === 'percentage') patch.discount_type = body.discount_type
  if (Number.isFinite(body.discount_amount_cents) && (body.discount_amount_cents as number) >= 0) {
    let amount = Math.round(body.discount_amount_cents as number)
    // For a percentage discount the amount is a raw percent — cap at 100 so the
    // admin can't store a nonsensical value (computePromoterDiscountCents also
    // caps at the base, but don't persist >100%).
    if (patch.discount_type === 'percentage') amount = Math.min(amount, 100)
    patch.discount_amount_cents = amount
  }

  const { settings, ok } = await updatePromoterSettings(patch)
  if (!ok) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 502 })
  return NextResponse.json({ settings })
})
