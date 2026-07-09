/**
 * lib/announcements-admin.ts
 *
 * The PURE half of the `/admin/contenido` announcement write surface (epic 08 ·
 * admin-content-and-announcements, Sprint 3) — mirrors `lib/copy-overrides-admin.ts`:
 * kept free of `next/*`, `server-only`, and the Supabase client, so it's unit-testable
 * with zero network. A MUTATION, so it rejects rather than coerces (per LEARNINGS) — a
 * malformed `cta_link` (non-http(s) scheme) is dropped from the write rather than
 * "fixed", same posture as `httpUrl()` (`lib/settings-import.ts`) it wraps.
 */
import { httpUrl } from './settings-import'

export type AnnouncementWriteParse =
  | {
      ok: true
      id: string | null
      audience: 'seller' | 'buyer'
      text: string
      ctaLabel: string | null
      ctaLink: string | null
      startsAt: string | null
      endsAt: string | null
      active: boolean
      replaceExisting: boolean
    }
  | { ok: false; error: string }

function toIsoOrNull(v: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v == null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: `${field} inválida.` }
  const ms = Date.parse(v)
  if (Number.isNaN(ms)) return { ok: false, error: `${field} inválida.` }
  return { ok: true, value: new Date(ms).toISOString() }
}

/**
 * Validate a `POST /api/admin/announcements` body (create when `id` is absent, update
 * when present). `ctaLink`, if given, must be http(s) — a `javascript:`/other scheme
 * value is REJECTED, never repaired, exactly the `httpUrl()` contract. Rejects an
 * `endsAt` at or before `startsAt` when both are given. `replaceExisting` defaults to
 * `false` — the route's one-active-per-audience conflict check (`decideActivationConflict`,
 * `lib/announcements-merge.ts`) is the caller's job, not this validator's.
 */
export function parseAnnouncementWriteBody(body: unknown): AnnouncementWriteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { id, audience, text, ctaLabel, ctaLink, startsAt, endsAt, active, replaceExisting } =
    body as Record<string, unknown>

  if (id !== undefined && id !== null && typeof id !== 'string') {
    return { ok: false, error: 'Id inválido.' }
  }
  if (audience !== 'seller' && audience !== 'buyer') {
    return { ok: false, error: 'Audiencia inválida — debe ser "seller" o "buyer".' }
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'El texto no puede estar vacío.' }
  }
  if (ctaLabel !== undefined && ctaLabel !== null && typeof ctaLabel !== 'string') {
    return { ok: false, error: 'Etiqueta de CTA inválida.' }
  }
  let parsedCtaLink: string | null = null
  if (ctaLink !== undefined && ctaLink !== null && ctaLink !== '') {
    const valid = httpUrl(ctaLink)
    if (!valid) return { ok: false, error: 'El link del CTA debe ser una URL http(s) válida.' }
    parsedCtaLink = valid
  }

  const startsParsed = toIsoOrNull(startsAt, 'Fecha de inicio')
  if (!startsParsed.ok) return startsParsed
  const endsParsed = toIsoOrNull(endsAt, 'Fecha de fin')
  if (!endsParsed.ok) return endsParsed
  if (startsParsed.value && endsParsed.value && Date.parse(endsParsed.value) <= Date.parse(startsParsed.value)) {
    return { ok: false, error: 'La fecha de fin debe ser posterior a la de inicio.' }
  }

  if (typeof active !== 'boolean') {
    return { ok: false, error: 'El estado activo debe ser verdadero o falso.' }
  }
  if (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') {
    return { ok: false, error: 'replaceExisting inválido.' }
  }

  return {
    ok: true,
    id: (id as string | undefined) ?? null,
    audience,
    text: text.trim(),
    ctaLabel: (ctaLabel as string | undefined)?.trim() || null,
    ctaLink: parsedCtaLink,
    startsAt: startsParsed.value,
    endsAt: endsParsed.value,
    active,
    replaceExisting: Boolean(replaceExisting),
  }
}

export type AnnouncementDeleteParse = { ok: true; id: string } | { ok: false; error: string }

/** Validate a `DELETE /api/admin/announcements` body. */
export function parseAnnouncementDeleteBody(body: unknown): AnnouncementDeleteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { id } = body as Record<string, unknown>
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, error: 'Id inválido.' }
  }
  return { ok: true, id }
}
