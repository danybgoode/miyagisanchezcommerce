import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const { data } = await db
    .from('marketplace_scrape_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ runs: data ?? [] })
})
