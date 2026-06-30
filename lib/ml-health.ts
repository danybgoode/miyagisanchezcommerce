/**
 * lib/ml-health.ts — pure, framework-free mirror of the backend ML module's
 * connection-health derivation + linkage duplicate guard (epic 03 ·
 * mercadolibre-sync, Sprint 1). The backend (apps/backend/src/modules/mercadolibre/
 * _utils.ts) is the source of truth and computes health for the wire response;
 * this mirror exists so the seller status surface can label a health state and so
 * the `api` Playwright gate can assert it without a live backend.
 *
 * No next/cache, no network — safe to import from the Playwright runner.
 */

export type MlHealthState = 'connected' | 'stale' | 'expired' | 'disconnected'
export type MlHealth = { state: MlHealthState; label_es: string }

export const REFRESH_SKEW_MS = 5 * 60 * 1000

function toMillis(v: Date | string | number | null | undefined): number {
  if (v == null) return NaN
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  return new Date(v).getTime()
}

/** Mirror of the backend's `deriveConnectionHealth`. es-MX labels. */
export function deriveConnectionHealth(
  conn: { status?: string | null; expires_at?: Date | string | number | null } | null | undefined,
  now: number = Date.now(),
): MlHealth {
  if (!conn || conn.status === 'disconnected' || conn.expires_at == null) {
    return { state: 'disconnected', label_es: 'No conectado' }
  }
  const exp = toMillis(conn.expires_at)
  if (Number.isNaN(exp) || exp <= now) {
    return { state: 'expired', label_es: 'Conexión expirada — vuelve a conectar' }
  }
  if (exp - now < REFRESH_SKEW_MS) {
    return { state: 'stale', label_es: 'Conexión por renovar' }
  }
  return { state: 'connected', label_es: 'Conectado' }
}

/** Mirror of the backend's `isDuplicateLink` — the 1:1 conflict guard. `existing`
 *  is the set of links already matching the candidate's product OR ml_item. */
type LinkPair = { product_id: string; ml_item_id: string }
export function isDuplicateLink(existing: LinkPair[], candidate: LinkPair): boolean {
  return existing.some(
    (l) => l.product_id === candidate.product_id || l.ml_item_id === candidate.ml_item_id,
  )
}
