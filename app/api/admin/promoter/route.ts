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
    patch.discount_amount_cents = Math.round(body.discount_amount_cents as number)
  }

  const settings = await updatePromoterSettings(patch)
  return NextResponse.json({ settings })
})
