/**
 * /api/admin/print/social  (Clerk admin-gated via withAdmin)
 *   GET  — list social submissions (optionally ?status= / ?edition_id=)
 *   POST — create an editor-authored item (source 'editor')
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'
import { PRINT_SOCIAL_TYPES, type PrintSocialType } from '@/lib/print'

export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set(PRINT_SOCIAL_TYPES.map((t) => t.key))

export const GET = withAdmin(async (req: NextRequest) => {
  const status = req.nextUrl.searchParams.get('status')
  let query = db.from('print_social_submissions').select('*, print_editions(title)').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const caption = String(body.caption ?? '').trim()
  if (!caption) return NextResponse.json({ error: 'caption required' }, { status: 400 })
  const type = (typeof body.type === 'string' && VALID_TYPES.has(body.type as PrintSocialType) ? body.type : 'otro') as PrintSocialType

  const { data, error } = await db
    .from('print_social_submissions')
    .insert({
      type,
      caption: caption.slice(0, 200),
      body: typeof body.body === 'string' ? body.body.slice(0, 1000) : null,
      photos: Array.isArray(body.photos) ? body.photos : [],
      zone: typeof body.zone === 'string' ? body.zone.slice(0, 80) : null,
      edition_id: typeof body.edition_id === 'string' ? body.edition_id : null,
      status: 'approved',
      source: 'editor',
    })
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  return NextResponse.json({ submission: data }, { status: 201 })
})
