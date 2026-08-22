export type OutputFormat = 'avif' | 'webp' | 'jpeg'

export const LEGACY_WIDTHS = [64, 96, 128, 160, 256, 320, 384, 480, 640, 750, 828, 960, 1080, 1200, 1600, 1920] as const
export const LOADER_WIDTHS = [64, 96, 384, 640, 828, 1200, 1920] as const
export const LEGACY_QUALITIES = [60, 75, 90] as const

export type ImageVariant = {
  src: string
  width: number
  quality: number
  fixedFormat: 'webp' | null
}

export type ImageVariantDecision =
  | { ok: true; variant: ImageVariant }
  | { ok: false; error: string }

/**
 * Resolve only cache-key-canonical variants. Cloudflare keys the raw query,
 * before this route can normalize a width or quality; accepting aliases would let
 * many edge MISSes trigger the same Sharp encode. The legacy branch preserves
 * every URL the old custom loader actually emitted. The fixed branch accepts
 * only the one versioned shape emitted by the new loader.
 */
export function resolveImageVariant(searchParams: URLSearchParams): ImageVariantDecision {
  const src = searchParams.get('url')
  const rawWidth = searchParams.get('w')
  const rawQuality = searchParams.get('q')
  if (!src || !rawWidth || !rawQuality) return { ok: false, error: 'Parámetros de imagen incompletos.' }

  const width = Number(rawWidth)
  const quality = Number(rawQuality)
  const requestedFormat = searchParams.get('f')
  const fixed = requestedFormat !== null

  if (fixed && (requestedFormat !== 'webp' || searchParams.get('v') !== '2')) {
    return { ok: false, error: 'Formato de imagen no permitido.' }
  }

  const widths: readonly number[] = fixed ? LOADER_WIDTHS : LEGACY_WIDTHS
  if (!Number.isInteger(width) || !widths.includes(width)) {
    return { ok: false, error: 'Ancho de imagen no permitido.' }
  }
  if (!Number.isInteger(quality) || (fixed ? quality !== 75 : !LEGACY_QUALITIES.includes(quality as 60 | 75 | 90))) {
    return { ok: false, error: 'Calidad de imagen no permitida.' }
  }

  const canonical = new URLSearchParams({ url: src, w: rawWidth, q: rawQuality })
  if (fixed) {
    canonical.set('f', 'webp')
    canonical.set('v', '2')
  }
  if (searchParams.toString() !== canonical.toString()) {
    return { ok: false, error: 'Parámetros de imagen no canónicos.' }
  }

  return { ok: true, variant: { src, width, quality, fixedFormat: fixed ? 'webp' : null } }
}

export function selectImageFormat(fixedFormat: 'webp' | null, accept: string): OutputFormat {
  if (fixedFormat) return fixedFormat
  if (accept.includes('image/avif')) return 'avif'
  if (accept.includes('image/webp')) return 'webp'
  return 'jpeg'
}

export function imageVaryHeader(fixedFormat: 'webp' | null): { Vary: 'Accept' } | Record<string, never> {
  return fixedFormat ? {} : { Vary: 'Accept' }
}
