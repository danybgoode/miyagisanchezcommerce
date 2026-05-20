import { NextRequest, NextResponse } from 'next/server'

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret') ?? req.nextUrl.searchParams.get('secret')
  return secret === process.env.ADMIN_SECRET
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nickname = req.nextUrl.searchParams.get('nickname') ?? 'automotrizgtrcoyoacn'
  const key = process.env.SERPAPI_KEY

  // --- Step 1: Exactly replicate the scrapeMLSeller URL build ---
  const searchUrl = new URL('https://serpapi.com/search.json')
  searchUrl.searchParams.set('engine', 'google')
  searchUrl.searchParams.set('q', `(site:auto.mercadolibre.com.mx OR site:articulo.mercadolibre.com.mx) ${nickname}`)
  searchUrl.searchParams.set('gl', 'mx')
  searchUrl.searchParams.set('hl', 'es')
  searchUrl.searchParams.set('num', '10')
  searchUrl.searchParams.set('start', '0')   // same as page=0
  searchUrl.searchParams.set('api_key', key ?? 'MISSING')

  const res = await fetch(searchUrl.toString(), {
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })

  const body = await res.json() as { organic_results?: { title?: string; link?: string }[]; error?: string }

  const results = body.organic_results ?? []

  // --- Step 2: Apply the same MLM regex filter ---
  const MLM_RE = /MLM[-_]?\d+/i
  const filteredLinks = results
    .filter(r => r.link && MLM_RE.test(r.link))
    .map(r => ({ link: r.link, title: r.title }))

  return NextResponse.json({
    key_present: !!key,
    key_prefix: key ? key.slice(0, 8) + '...' : null,
    http_status: res.status,
    serp_error: body.error ?? null,
    raw_count: results.length,
    filtered_count: filteredLinks.length,
    raw_first_link: results[0]?.link ?? null,
    filtered_items: filteredLinks.slice(0, 5),
    built_url_sans_key: searchUrl.toString().replace(key ?? '', '[KEY]'),
    regex_test_on_first: results[0]?.link ? MLM_RE.test(results[0].link) : null,
  })
}
