/**
 * /api/admin/print/editions/[id]  (Clerk admin-gated via withAdmin)
 *   PATCH — update edition fields / status; mints products for any new priced tier
 *   DELETE — delete an edition (only when it has no submissions)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { ensureTierProducts } from '@/lib/print-server'
import { withAdmin } from '@/lib/admin/guard'
import type { PrintEdition, PrintTier } from '@/lib/print'

export const dynamic = 'force-dynamic'

const EDITABLE = ['title', 'status', 'submission_deadline', 'distribution_date', 'coverage_zones'] as const

export const PATCH = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: Record<string, unknown> & { tiers?: PrintTier[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { data: existing } = await db
    .from('print_editions').select('*').eq('id', id).single() as { data: PrintEdition | null }
  if (!existing) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in body) patch[key] = body[key]

  let failed: string[] = []
  if (Array.isArray(body.tiers)) {
    // Mint products for any newly added priced tier; keep existing product ids.
    const result = await ensureTierProducts(String(patch.title ?? existing.title), id, body.tiers)
    patch.tiers = result.tiers
    failed = result.failed
  }

  const { data, error } = await db.from('print_editions').update(patch).eq('id', id).select('*').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ edition: data, failed_tiers: failed })
})

export const DELETE = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const { count } = await db
    .from('print_ad_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('edition_id', id)
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'No se puede borrar: la edición tiene anuncios.' }, { status: 422 })
  }

  const { error } = await db.from('print_editions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
})
