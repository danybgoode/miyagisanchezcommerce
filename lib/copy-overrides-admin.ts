/**
 * lib/copy-overrides-admin.ts
 *
 * The PURE half of the `/admin/contenido` write surface (epic 08 ·
 * admin-content-and-announcements, Sprint 1) — mirrors `lib/flags-admin.ts`'s
 * `parseFlagWriteBody`: kept free of `next/*`, `server-only`, the Supabase client,
 * AND the raw `locales/*.json` dictionary import (see `copy-overrides-merge.ts`'s
 * header — a real JSON import breaks under the Playwright `api` runner's native
 * ESM loader), so it's unit-testable with zero network/dictionary infra.
 *
 * The "known paths" universe (which `namespace.key` combinations actually exist)
 * is passed IN by the caller (the route handler, which builds it from the real
 * dictionary via `flattenDictionary`) rather than imported here — this is what
 * keeps the parser test-friendly while still enforcing "the dictionary defines
 * the universe: an unknown key is rejected, never created."
 */
import { isBilingualNamespace } from './bilingual-namespaces'

export type CopyOverrideWriteParse =
  | { ok: true; namespace: string; key: string; locale: 'es' | 'en'; value: string }
  | { ok: false; error: string }

/**
 * Validate a `POST /api/admin/content-overrides` body. Rejects (Spanish `error`) a
 * malformed shape, an unknown `namespace.key` (not in `knownPaths` — the compile-time
 * dictionary), or an `en` locale on a namespace outside the bilingual allow-list.
 * This is a MUTATION, so it rejects rather than coerces (per LEARNINGS).
 */
export function parseCopyOverrideWriteBody(
  body: unknown,
  knownPaths: ReadonlySet<string>,
): CopyOverrideWriteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { namespace, key, locale, value } = body as Record<string, unknown>

  if (typeof namespace !== 'string' || namespace.length === 0) {
    return { ok: false, error: 'Namespace inválido.' }
  }
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, error: 'Clave inválida.' }
  }
  if (locale !== 'es' && locale !== 'en') {
    return { ok: false, error: 'Locale inválido — debe ser "es" o "en".' }
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'El valor debe ser texto.' }
  }
  if (!knownPaths.has(`${namespace}.${key}`)) {
    return { ok: false, error: 'Esa clave no existe en el diccionario.' }
  }
  if (locale === 'en' && !isBilingualNamespace(namespace)) {
    return { ok: false, error: 'Este namespace no admite inglés.' }
  }
  return { ok: true, namespace, key, locale, value }
}

export type CopyOverrideDeleteParse =
  | { ok: true; namespace: string; key: string; locale: 'es' | 'en' }
  | { ok: false; error: string }

/**
 * Validate a `DELETE /api/admin/content-overrides` body (the «restaurar» action).
 * Deliberately does NOT check `knownPaths` — restoring/deleting a stale (orphaned)
 * override row must stay possible even after the key it named has left the
 * dictionary, which is exactly the cleanup an orphan flag exists to enable.
 */
export function parseCopyOverrideDeleteBody(body: unknown): CopyOverrideDeleteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { namespace, key, locale } = body as Record<string, unknown>

  if (typeof namespace !== 'string' || namespace.length === 0) {
    return { ok: false, error: 'Namespace inválido.' }
  }
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, error: 'Clave inválida.' }
  }
  if (locale !== 'es' && locale !== 'en') {
    return { ok: false, error: 'Locale inválido — debe ser "es" o "en".' }
  }
  return { ok: true, namespace, key, locale }
}
