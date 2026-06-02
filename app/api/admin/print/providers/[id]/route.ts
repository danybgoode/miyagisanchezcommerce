/**
 * /api/admin/print/providers/[id]  (secret-gated)
 *   PATCH  — update a provider
 *   DELETE — delete a provider (blocked if it has editions)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { checkAdminSecret } from '@/lib/print-server'

export const dynamic = 'force-dynamic'

const EDITABLE = [
  'name', 'description', 'is_default', 'active', 'location',
  'coverage_zones', 'distribution_notes', 'schedule_notes', 'preview_url', 'file_spec',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in body) patch[key] = body[key]

  const { data, error } = await db.from('print_providers').update(patch).eq('id', id).select('*').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ provider: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { count } = await db
    .from('print_editions')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', id)
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'No se puede borrar: el proveedor tiene ediciones.' }, { status: 422 })
  }

  const { error } = await db.from('print_providers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
