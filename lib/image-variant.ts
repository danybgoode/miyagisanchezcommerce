export type OutputFormat = 'avif' | 'webp' | 'jpeg'

export const TRANSFORM_WIDTHS = [64, 96, 128, 160, 256, 320, 384, 480, 640, 750, 828, 960, 1080, 1200, 1600, 1920] as const
// Union of the shipped route ladder and every width the old default Next
// config emitted. The out-of-ladder edge keys still map to the old snapped
// transform (32/48 → 64; 2048/3840 → 1920), so stale HTML remains valid.
export const LEGACY_KEY_WIDTHS = [32, 48, 64, 96, 128, 160, 256, 320, 384, 480, 640, 750, 828, 960, 1080, 1200, 1600, 1920, 2048, 3840] as const
export const LOADER_DEVICE_WIDTHS = [384, 640, 828, 1200, 1920] as const
export const LOADER_IMAGE_WIDTHS = [64, 96] as const
const LOADER_WIDTHS: readonly number[] = [...LOADER_IMAGE_WIDTHS, ...LOADER_DEVICE_WIDTHS]
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

function legacyTransformWidth(requested: number): number {
  for (const width of TRANSFORM_WIDTHS) if (width >= requested) return width
  return TRANSFORM_WIDTHS[TRANSFORM_WIDTHS.length - 1]
}

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

  try {
    const parsedSrc = new URL(src)
    // Fragments are not sent upstream. Accepting them would create unlimited
    // distinct Cloudflare keys for the same fetch and Sharp transform.
    if (parsedSrc.hash || parsedSrc.toString() !== src) return { ok: false, error: 'URL de imagen no canónica.' }
  } catch {
    return { ok: false, error: 'URL de imagen inválida.' }
  }

  const width = Number(rawWidth)
  const quality = Number(rawQuality)
  const requestedFormat = searchParams.get('f')
  const fixed = requestedFormat !== null

  if (fixed && (requestedFormat !== 'webp' || searchParams.get('v') !== '2')) {
    return { ok: false, error: 'Formato de imagen no permitido.' }
  }

  const widths: readonly number[] = fixed ? LOADER_WIDTHS : LEGACY_KEY_WIDTHS
  if (!Number.isInteger(width) || String(width) !== rawWidth || !widths.includes(width)) {
    return { ok: false, error: 'Ancho de imagen no permitido.' }
  }
  if (!Number.isInteger(quality) || String(quality) !== rawQuality || (fixed ? quality !== 75 : !LEGACY_QUALITIES.includes(quality as 60 | 75 | 90))) {
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

  return { ok: true, variant: { src, width: fixed ? width : legacyTransformWidth(width), quality, fixedFormat: fixed ? 'webp' : null } }
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
