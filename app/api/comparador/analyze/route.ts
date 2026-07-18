import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { analyzeShopUrl } from '@/lib/shop-url-analyzer-fetch'

/**
 * POST /api/comparador/analyze — the shop-URL analyzer's HTTP surface (epic 08
 * · cost-comparator-homepage, Sprint 3 · US-3.1). Anonymous, public, no login
 * (`/comparador` itself is anonymous by design — see the epic README). Every
 * failure returns a controlled status + an es-MX, non-technical `error`
 * string — never a 500 — so the client can always fall back to manual entry,
 * per sprint-3.md's acceptance ("degrades gracefully to manual entry on any
 * failure/timeout").
 */

const MAX_URL_LENGTH = 2048

export async function POST(req: NextRequest) {
  // Rate limit FIRST — this route triggers a server-side external fetch of a
  // caller-supplied URL, so the anti-abuse gate must run before any parsing
  // or network work, same ordering as app/api/sell/import/extract/route.ts.
  const rl = await checkRateLimit('comparator_analyze', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Muchos análisis seguidos — espera ${Math.max(1, Math.ceil(rl.retryAfter / 60))} min o llena los datos a mano abajo.`,
      },
      { status: 429 },
    )
  }

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ error: 'Ingresa la URL de tu tienda.' }, { status: 422 })
  }
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: 'Esa URL es demasiado larga.' }, { status: 422 })
  }

  const analyzed = await analyzeShopUrl(url)
  if (!analyzed.ok) {
    return NextResponse.json({ error: analyzed.error }, { status: analyzed.status })
  }

  return NextResponse.json(analyzed.result)
}
