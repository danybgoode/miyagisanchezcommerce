import { NextRequest, NextResponse } from 'next/server'

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret') ?? req.nextUrl.searchParams.get('secret')
  return secret === process.env.ADMIN_SECRET
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = process.env.SERPAPI_KEY
  const q = req.nextUrl.searchParams.get('q') ?? '(site:auto.mercadolibre.com.mx OR site:articulo.mercadolibre.com.mx) automotrizgtrcoyoacn'

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', q)
  url.searchParams.set('gl', 'mx')
  url.searchParams.set('hl', 'es')
  url.searchParams.set('num', '10')
  url.searchParams.set('api_key', key ?? 'MISSING')

  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const body = await res.json()

  return NextResponse.json({
    key_present: !!key,
    key_prefix: key ? key.slice(0, 8) + '...' : null,
    http_status: res.status,
    has_organic: Array.isArray(body.organic_results),
    organic_count: body.organic_results?.length ?? 0,
    serp_error: body.error ?? null,
    first_link: body.organic_results?.[0]?.link ?? null,
    request_url_sans_key: url.toString().replace(key ?? '', '[KEY]'),
  })
}
