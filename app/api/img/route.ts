/**
 * Self-hosted image resize/format proxy (09-platform-infra/hyper-performant-website
 * S1.1 spike-lite decision — see sprint-1.md for the full write-up).
 *
 * `next/image`'s built-in `/_next/image` optimizer is a dead end in this
 * container (confirmed open upstream `output: 'standalone'` regression,
 * vercel/next.js#82610 — see lib/image-loader.ts's header comment for the
 * paper trail). Cloudflare Images / zone-level Image Resizing would work but
 * need a dashboard/paid-product mutation this agent can't apply. So: a small
 * `sharp`-based route (sharp is already a proven working dependency in this
 * exact container — the Dockerfile explicitly reinstalls it in the runner
 * stage) that resizes + re-encodes on request, called via next/image's
 * CUSTOM loader (lib/image-loader.ts) — never through the broken route.
 *
 *   GET /api/img?url=<https URL>&w=<width>&q=<quality 40-90>
 *
 * Security: `url` must be `https:` and its hostname must be in the allow-list
 * derived from R2_PUBLIC_URL (+ NEXT_PUBLIC_SUPABASE_URL, the storage
 * fallback per lib/r2.ts's isR2Configured() comment) — an open proxy that
 * fetches ANY caller-supplied URL is an SSRF hole, so this is intentionally
 * NOT `hostname: '**'` like next.config.ts's now-unused (custom-loader mode
 * ignores it) remotePatterns.
 *
 * Width is snapped to a small fixed ladder (not arbitrary caller-chosen
 * pixels) for two reasons: (1) bounds the sharp-encode cost per request, and
 * (2) keeps the Cache-Control cache-key space small so a Cloudflare Cache
 * Rule on this path (the one shared-edge-infra ask from this sprint) gets
 * real hit rates instead of one entry per pixel.
 *
 * Format negotiation follows the Accept header (avif > webp > jpeg passthrough),
 * mirroring next.config.ts's `images.formats` intent.
 */
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export const runtime = 'nodejs'

const WIDTH_LADDER = [64, 96, 128, 160, 256, 320, 384, 480, 640, 750, 828, 960, 1080, 1200, 1600, 1920]
const MIN_Q = 40
const MAX_Q = 90
const DEFAULT_Q = 75
const FETCH_TIMEOUT_MS = 10_000
// Guard against a runaway origin response inflating memory before sharp gets to shrink it.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

function allowedHosts(): Set<string> {
  const hosts = new Set<string>()
  for (const raw of [process.env.R2_PUBLIC_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    if (!raw) continue
    try { hosts.add(new URL(raw).hostname) } catch { /* ignore malformed env */ }
  }
  return hosts
}

function snapWidth(requested: number): number {
  for (const w of WIDTH_LADDER) if (w >= requested) return w
  return WIDTH_LADDER[WIDTH_LADDER.length - 1]
}

function clampQuality(requested: number): number {
  return Math.min(MAX_Q, Math.max(MIN_Q, requested))
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const src = searchParams.get('url')
  if (!src) return NextResponse.json({ error: 'url requerido.' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return NextResponse.json({ error: 'url inválida.' }, { status: 400 })
  }

  const hosts = allowedHosts()
  if (parsed.protocol !== 'https:' || hosts.size === 0 || !hosts.has(parsed.hostname)) {
    return NextResponse.json({ error: 'host de origen no permitido.' }, { status: 400 })
  }

  const requestedW = parseInt(searchParams.get('w') ?? '', 10)
  const width = snapWidth(Number.isFinite(requestedW) && requestedW > 0 ? requestedW : 640)
  const requestedQ = parseInt(searchParams.get('q') ?? '', 10)
  const quality = clampQuality(Number.isFinite(requestedQ) && requestedQ > 0 ? requestedQ : DEFAULT_Q)

  let upstream: Response
  try {
    upstream = await fetch(parsed.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch {
    return NextResponse.json({ error: 'no se pudo descargar la imagen de origen.' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'imagen de origen no disponible.' }, { status: 502 })
  }
  const upstreamType = upstream.headers.get('content-type') ?? ''
  if (!upstreamType.startsWith('image/')) {
    return NextResponse.json({ error: 'el recurso de origen no es una imagen.' }, { status: 415 })
  }
  const upstreamLen = Number(upstream.headers.get('content-length') ?? '0')
  if (upstreamLen > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: 'imagen de origen demasiado grande.' }, { status: 413 })
  }

  const srcBuf = Buffer.from(await upstream.arrayBuffer())
  if (srcBuf.byteLength > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: 'imagen de origen demasiado grande.' }, { status: 413 })
  }

  const accept = req.headers.get('accept') ?? ''
  const format: 'avif' | 'webp' | 'jpeg' = accept.includes('image/avif')
    ? 'avif'
    : accept.includes('image/webp')
      ? 'webp'
      : 'jpeg'

  let outBuf: Buffer
  let outType: string
  try {
    // rotate() applies EXIF orientation before resizing; withoutEnlargement never
    // upscales a source smaller than the requested width (no manufactured detail).
    const pipeline = sharp(srcBuf).rotate().resize({ width, withoutEnlargement: true })
    if (format === 'avif') {
      outBuf = await pipeline.avif({ quality }).toBuffer()
      outType = 'image/avif'
    } else if (format === 'webp') {
      outBuf = await pipeline.webp({ quality }).toBuffer()
      outType = 'image/webp'
    } else {
      outBuf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
      outType = 'image/jpeg'
    }
  } catch (err) {
    console.error('[api/img] sharp transform failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'no se pudo procesar la imagen.' }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(outBuf), {
    status: 200,
    headers: {
      'Content-Type': outType,
      // Long-lived + immutable: the URL fully encodes (source url, width, quality),
      // so a different image is a different URL. Matches the bucket-level
      // Cache-Control this sprint also sets on new R2 uploads (lib/r2.ts).
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Vary': 'Accept',
    },
  })
}
