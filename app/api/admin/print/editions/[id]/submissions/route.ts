/**
 * GET /api/admin/print/editions/[id]/submissions  (Clerk admin-gated via withAdmin)
 * Lists all ad submissions for an edition (the editorial queue).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { data, error } = await db
    .from('print_ad_submissions')
    .select('*')
    .eq('edition_id', id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
})
