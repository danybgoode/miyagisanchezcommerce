/**
 * Living Shop — the ONE Wall validator (epic 07 · living-shop-social-storefront).
 *
 * Pure and next-free, so the Playwright `api` runner exercises it with no
 * network. Both write surfaces call it — the seller HTTP route and the MCP Wall
 * tools (epic D12). If an agent could reach a laxer path than a human, the
 * schema has forked and one of the two is wrong; a shared validator is how that
 * stays impossible rather than merely discouraged.
 *
 * It validates SHAPE and GRAMMAR. It cannot validate OWNERSHIP — that needs the
 * database — so the caller must still prove the reference belongs to the caller's
 * shop before persisting (epic D3). A validator that returned `ok` for a foreign
 * product id would be exactly the "admission proof that does not match what is
 * consumed" failure this codebase has already shipped once.
 */

import type { WallKind, WallStatus, WallMedia, WallEntryInput } from './types'

export const WALL_KINDS: readonly WallKind[] = ['post', 'product', 'collection', 'event'] as const
export const WALL_STATUSES: readonly WallStatus[] = ['draft', 'published', 'scheduled'] as const

/** Mirrors the table's CHECK. Kept as one constant so route copy and DDL cannot drift apart. */
export const WALL_BODY_MAX = 2000
export const WALL_MEDIA_MAX = 4
export const WALL_ALT_MAX = 200
export const WALL_REFERENCE_MAX = 255

/** The public read's page size. Bounded initial payload is an S7.4 acceptance criterion. */
export const WALL_PAGE_SIZE = 12

export interface WallValidationIssue {
  field: string
  message: string
}

export interface WallValidated {
  kind: WallKind
  status: WallStatus
  body: string | null
  media: WallMedia[]
  reference_id: string | null
  scheduled_for: string | null
  pinned: boolean
}

export type WallValidationResult =
  | { ok: true; value: WallValidated }
  | { ok: false; issues: WallValidationIssue[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function isWallKind(v: unknown): v is WallKind {
  return typeof v === 'string' && (WALL_KINDS as readonly string[]).includes(v)
}

function isWallStatus(v: unknown): v is WallStatus {
  return typeof v === 'string' && (WALL_STATUSES as readonly string[]).includes(v)
}

/**
 * Accept only a platform-issued image URL. `https` and a path — no `javascript:`,
 * no `data:`, no protocol-relative form. The upload route is the only issuer
 * (epic D10), so a URL that did not come from it is a URL we cannot vouch for.
 */
export function isPlatformMediaUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return false
  }
  return url.protocol === 'https:'
}

/**
 * Parse a seller-supplied instant. Accepts anything `Date` accepts that carries
 * an explicit offset or a `Z`, and REFUSES a bare `2026-08-18T10:00` — that form
 * is the server-local ambiguity the scope calls out by name, and silently
 * interpreting it in the server's zone is how a merchant's 10am becomes 4am.
 * Returns the canonical ISO instant, so the stored value is offset-independent.
 */
export function parseOffsetAwareInstant(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  // Must end in Z or ±HH:MM / ±HHMM.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return null
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

function normalizeMedia(v: unknown, issues: WallValidationIssue[]): WallMedia[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    issues.push({ field: 'media', message: 'media debe ser una lista.' })
    return []
  }
  if (v.length > WALL_MEDIA_MAX) {
    issues.push({ field: 'media', message: `Máximo ${WALL_MEDIA_MAX} imágenes por publicación.` })
    return []
  }
  const out: WallMedia[] = []
  v.forEach((raw, i) => {
    if (!isObject(raw)) {
      issues.push({ field: `media[${i}]`, message: 'Cada imagen debe ser un objeto { url, alt }.' })
      return
    }
    if (!isPlatformMediaUrl(raw.url)) {
      issues.push({ field: `media[${i}].url`, message: 'La imagen debe ser una URL https subida a Miyagi Sánchez.' })
      return
    }
    const alt = typeof raw.alt === 'string' ? raw.alt.trim().slice(0, WALL_ALT_MAX) : ''
    out.push({ url: raw.url, alt })
  })
  return out
}

/**
 * Validate a create payload. `kind` is required and closed; everything else
 * derives its rules from it.
 */
export function validateWallEntryCreate(input: WallEntryInput): WallValidationResult {
  const issues: WallValidationIssue[] = []

  if (!isWallKind(input.kind)) {
    // Without a kind there is no grammar to check the rest against, so stop here
    // rather than emit a cascade of derived complaints.
    return { ok: false, issues: [{ field: 'kind', message: 'kind debe ser post, product, collection o event.' }] }
  }
  const kind = input.kind

  const status: WallStatus = input.status === undefined ? 'draft'
    : isWallStatus(input.status) ? input.status
    : (issues.push({ field: 'status', message: 'status debe ser draft, published o scheduled.' }), 'draft')

  const rawBody = input.body === undefined || input.body === null ? '' : typeof input.body === 'string' ? input.body : null
  if (rawBody === null) issues.push({ field: 'body', message: 'body debe ser texto.' })
  const body = (rawBody ?? '').trim()
  if (body.length > WALL_BODY_MAX) {
    issues.push({ field: 'body', message: `El texto no puede pasar de ${WALL_BODY_MAX} caracteres.` })
  }

  const media = normalizeMedia(input.media, issues)

  // Reference/kind pairing — the same rule the table enforces, stated once here so
  // the seller gets a sentence instead of a constraint-violation error string.
  let reference_id: string | null = null
  if (kind === 'post') {
    if (typeof input.reference_id === 'string' && input.reference_id.trim()) {
      issues.push({ field: 'reference_id', message: 'Una publicación de texto no lleva referencia.' })
    }
    if (!body && media.length === 0) {
      issues.push({ field: 'body', message: 'Una publicación necesita texto o al menos una imagen.' })
    }
  } else {
    const ref = typeof input.reference_id === 'string' ? input.reference_id.trim() : ''
    if (!ref) {
      issues.push({ field: 'reference_id', message: 'Elige el producto, la colección o el evento que quieres mostrar.' })
    } else if (ref.length > WALL_REFERENCE_MAX) {
      issues.push({ field: 'reference_id', message: 'La referencia es demasiado larga.' })
    } else {
      reference_id = ref
    }
    // Media on a referenced entry would compete with the canonical object's own
    // image and go stale beside it. The seller note (body) is the only extra.
    if (media.length > 0) {
      issues.push({ field: 'media', message: 'Los productos, colecciones y eventos ya traen su propia imagen.' })
    }
  }

  let scheduled_for: string | null = null
  if (status === 'scheduled') {
    scheduled_for = parseOffsetAwareInstant(input.scheduled_for)
    if (!scheduled_for) {
      issues.push({
        field: 'scheduled_for',
        message: 'Para programar necesitas una fecha con zona horaria explícita (por ejemplo 2026-09-01T18:00:00-06:00).',
      })
    }
  } else if (input.scheduled_for !== undefined && input.scheduled_for !== null) {
    issues.push({ field: 'scheduled_for', message: 'Solo una publicación programada lleva fecha de publicación.' })
  }

  const pinned = input.pinned === undefined ? false : input.pinned === true
  if (pinned && status === 'draft') {
    issues.push({ field: 'pinned', message: 'Solo puedes fijar una publicación publicada o programada.' })
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: { kind, status, body: body || null, media, reference_id, scheduled_for, pinned },
  }
}

/**
 * Validate an update. The existing entry supplies every field the caller left
 * out, so a partial patch is checked as the WHOLE resulting entry — a status
 * flip that would strand a `scheduled_for` has to fail, and it only can if the
 * merged shape is what gets validated.
 *
 * `kind` is immutable: allowing it to change would let a product entry keep a
 * reference it is no longer allowed to have, or a post inherit one.
 */
export function validateWallEntryUpdate(
  existing: Pick<WallValidated, 'kind' | 'status' | 'body' | 'media' | 'reference_id' | 'scheduled_for' | 'pinned'>,
  patch: WallEntryInput,
): WallValidationResult {
  if (patch.kind !== undefined && patch.kind !== existing.kind) {
    return { ok: false, issues: [{ field: 'kind', message: 'No se puede cambiar el tipo de una publicación. Crea otra.' }] }
  }
  const merged: WallEntryInput = {
    kind: existing.kind,
    status: patch.status === undefined ? existing.status : patch.status,
    body: patch.body === undefined ? existing.body ?? '' : patch.body,
    media: patch.media === undefined ? existing.media : patch.media,
    reference_id: patch.reference_id === undefined ? existing.reference_id ?? undefined : patch.reference_id,
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned,
  }
  // `scheduled_for` only travels with the scheduled status — carrying the old one
  // into a publish-now patch is what would strand it.
  const nextStatus = merged.status
  if (nextStatus === 'scheduled') {
    merged.scheduled_for = patch.scheduled_for === undefined ? existing.scheduled_for ?? undefined : patch.scheduled_for
  }
  return validateWallEntryCreate(merged)
}
