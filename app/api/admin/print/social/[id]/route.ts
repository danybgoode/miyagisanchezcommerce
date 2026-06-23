/**
 * PATCH /api/admin/print/social/[id]  (Clerk admin-gated via withAdmin)
 * Curate a social submission: status, edition assignment, web opt-in, admin_notes.
 * DELETE removes it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'
import { buildPrintSocialAdminPatch } from '@/lib/neighborhood-pulse'

export const dynamic = 'force-dynamic'

export const PATCH = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const result = buildPrintSocialAdminPatch(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const { data, error } = await db.from('print_social_submissions').update(result.patch).eq('id', id).select('*').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ submission: data })
})

export const DELETE = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { error } = await db.from('print_social_submissions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
})
