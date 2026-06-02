/**
 * PATCH /api/admin/print/social/[id]  (secret-gated)
 * Curate a social submission: status, edition assignment, admin_notes.
 * DELETE removes it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { checkAdminSecret } from '@/lib/print-server'
import type { PrintSocialStatus } from '@/lib/print'

export const dynamic = 'force-dynamic'

const STATUSES: PrintSocialStatus[] = ['submitted', 'approved', 'placed', 'rejected']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  let body: { status?: PrintSocialStatus; edition_id?: string | null; admin_notes?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (body.status) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    patch.status = body.status
  }
  if ('edition_id' in body) patch.edition_id = body.edition_id || null
  if (typeof body.admin_notes === 'string') patch.admin_notes = body.admin_notes
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await db.from('print_social_submissions').update(patch).eq('id', id).select('*').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ submission: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { error } = await db.from('print_social_submissions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
