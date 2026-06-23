import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'
import { getScrapeRunItems, scrapeItemsToCsv } from '@/lib/adminScrapeExport'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { data: run, error: runError } = await db
    .from('marketplace_scrape_runs')
    .select('id, source, started_at')
    .eq('id', id)
    .maybeSingle()

  if (runError) {
    return NextResponse.json({ error: runError.message }, { status: 500 })
  }
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const items = await getScrapeRunItems(id)
  if (items.length === 0) {
    return NextResponse.json({ error: 'No collected rows found for this run. Legacy runs created before CSV capture cannot be exported.' }, { status: 404 })
  }

  const csv = scrapeItemsToCsv(items)
  const date = String(run.started_at ?? new Date().toISOString()).slice(0, 10)
  const filename = `scrape-${String(run.source).replace(/[^a-z0-9_-]+/gi, '-')}-${date}-${id.slice(0, 8)}.csv`

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
})
