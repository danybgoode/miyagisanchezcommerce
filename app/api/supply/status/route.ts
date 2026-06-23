import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'

export const GET = withAdmin(async () => {
  const providers: Record<string, unknown> = {
    serpapi: {
      configured: Boolean(process.env.SERPAPI_KEY),
      ok: null,
      total_searches_left: null,
      plan_searches_left: null,
      error: null,
    },
    apify: {
      configured: Boolean(process.env.APIFY_TOKEN),
      ok: null,
      note: 'Actor launching is not connected in this workflow yet.',
    },
    mercadolibre: {
      configured: Boolean(process.env.ML_APP_ID && process.env.ML_APP_SECRET),
      ok: null,
      note: 'Official MLM search/detail APIs remain blocked unless the app has ML catalog access.',
    },
  }

  if (process.env.SERPAPI_KEY) {
    try {
      const url = new URL('https://serpapi.com/account.json')
      url.searchParams.set('api_key', process.env.SERPAPI_KEY)
      const res = await fetch(url.toString(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string
        total_searches_left?: number
        plan_searches_left?: number
        searches_per_month?: number
      }
      providers.serpapi = {
        configured: true,
        ok: res.ok && !data.error,
        total_searches_left: data.total_searches_left ?? null,
        plan_searches_left: data.plan_searches_left ?? null,
        searches_per_month: data.searches_per_month ?? null,
        error: data.error ?? (res.ok ? null : `HTTP ${res.status}`),
      }
    } catch (err) {
      providers.serpapi = {
        configured: true,
        ok: false,
        total_searches_left: null,
        plan_searches_left: null,
        searches_per_month: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return NextResponse.json({ providers })
})
