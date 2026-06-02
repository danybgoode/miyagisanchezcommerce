/**
 * GET /api/admin/print/editions/[id]/submissions  (secret-gated)
 * Lists all ad submissions for an edition (the editorial queue).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { checkAdminSecret } from '@/lib/print-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { data, error } = await db
    .from('print_ad_submissions')
    .select('*')
    .eq('edition_id', id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
}
