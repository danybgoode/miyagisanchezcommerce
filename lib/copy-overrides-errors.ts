/**
 * lib/copy-overrides-errors.ts
 *
 * Pure classifier for `platform_copy_overrides` store errors (epic 08 ·
 * cms-contenido-restore-and-polish, Sprint 1 Story 1.2). Kept free of `next/*`
 * and `server-only` — like `copy-overrides-merge.ts` — so a Playwright `api`
 * spec can load it directly with zero live Supabase infra.
 *
 * Distinguishes "the table itself is missing/unreachable" (the exact failure
 * mode that hid behind a generic 500 for two days before Story 1.1) from any
 * other Supabase error, so the editor can show an actionable es-MX message
 * instead of the same opaque "No se pudo guardar" for every failure.
 */

export type OverrideStoreErrorKind = 'store_unavailable' | 'unknown'

interface SupabaseLikeError {
  code?: string | null
  message?: string | null
}

/** Postgres/PostgREST codes meaning the relation itself is missing or unreachable. */
const STORE_UNAVAILABLE_CODES = new Set([
  '42P01', // Postgres: undefined_table
  'PGRST205', // PostgREST: table not found in schema cache
  'PGRST106', // PostgREST: schema not in the exposed search path
])

const STORE_UNAVAILABLE_MESSAGE_PATTERN = /relation .* does not exist/i

/** Classify a Supabase/PostgREST error object. Never throws — unrecognized shapes are 'unknown'. */
export function classifyOverrideStoreError(error: unknown): OverrideStoreErrorKind {
  if (!error || typeof error !== 'object') return 'unknown'
  const err = error as SupabaseLikeError
  if (typeof err.code === 'string' && STORE_UNAVAILABLE_CODES.has(err.code)) return 'store_unavailable'
  if (typeof err.message === 'string' && STORE_UNAVAILABLE_MESSAGE_PATTERN.test(err.message)) {
    return 'store_unavailable'
  }
  return 'unknown'
}

/** es-MX message shown when the store itself is missing/unreachable — not a generic save failure. */
export const OVERRIDE_STORE_UNAVAILABLE_MESSAGE = 'El almacén de overrides no está disponible.'
