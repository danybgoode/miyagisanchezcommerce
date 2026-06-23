/**
 * /api/admin/print/providers  (Clerk admin-gated via withAdmin)
 *   GET  — list all print providers
 *   POST — create a provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const { data, error } = await db
    .from('print_providers')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ providers: data ?? [] })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.slug || !body.name) {
    return NextResponse.json({ error: 'slug and name are required' }, { status: 400 })
  }

  const { data, error } = await db
    .from('print_providers')
    .insert({
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      is_default: body.is_default ?? false,
      active: body.active ?? true,
      location: body.location ?? null,
      coverage_zones: body.coverage_zones ?? [],
      distribution_notes: body.distribution_notes ?? null,
      schedule_notes: body.schedule_notes ?? null,
      preview_url: body.preview_url ?? null,
      file_spec: body.file_spec ?? {},
    })
    .select('*')
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ provider: data }, { status: 201 })
})
