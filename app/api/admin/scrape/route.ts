import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { scrapeSerpApiLocal } from '@/lib/scrapers/serpapi'
import { scrapeMercadoLibre, scrapeMLSeller } from '@/lib/scrapers/mercadolibre'

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret') ?? req.nextUrl.searchParams.get('secret')
  return secret === process.env.ADMIN_SECRET
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    source: 'serpapi_google_local' | 'mercadolibre_public' | 'mercadolibre_seller'
    params: Record<string, string | number>
  }
  const { source, params } = body

  // Create run record
  const { data: run, error: runErr } = await db
    .from('marketplace_scrape_runs')
    .insert({ source, params, status: 'running' })
    .select('id')
    .single()

  if (runErr || !run) {
    return NextResponse.json({ error: 'Failed to create run record' }, { status: 500 })
  }

  // Run scraper synchronously and return result
  try {
    let result: { inserted: number; skipped: number; errors: number; sellerNickname?: string }

    if (source === 'serpapi_google_local') {
      result = await scrapeSerpApiLocal({
        query: String(params.query ?? ''),
        location: String(params.location ?? 'Ciudad de México, Mexico'),
        state: String(params.state ?? 'Ciudad de México'),
        category: String(params.category ?? 'servicios'),
        limit: Number(params.limit ?? 20),
      })
    } else if (source === 'mercadolibre_public') {
      result = await scrapeMercadoLibre({
        query: String(params.query ?? ''),
        category: params.category ? String(params.category) : undefined,
        state: params.state ? String(params.state) : undefined,
        limit: Number(params.limit ?? 20),
        clerkUserId: params.clerkUserId ? String(params.clerkUserId) : undefined,
      })
    } else if (source === 'mercadolibre_seller') {
      result = await scrapeMLSeller({
        sellerUrl: String(params.sellerUrl ?? ''),
        category: params.category ? String(params.category) : undefined,
        limit: Number(params.limit ?? 50),
        clerkUserId: params.clerkUserId ? String(params.clerkUserId) : undefined,
      })
    } else {
      throw new Error(`Unknown source: ${source}`)
    }

    await db.from('marketplace_scrape_runs').update({
      status: 'completed',
      count_inserted: result.inserted,
      count_skipped: result.skipped,
      count_errors: result.errors,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id)

    return NextResponse.json({ runId: run.id, ...result })
  } catch (e) {
    await db.from('marketplace_scrape_runs').update({
      status: 'failed',
      error_message: String(e),
      completed_at: new Date().toISOString(),
    }).eq('id', run.id)
    return NextResponse.json({ error: String(e), runId: run.id }, { status: 500 })
  }
}
