/**
 * lib/ml-events-view.ts — PURE presentation helpers for the Mercado Libre sync
 * activity log (epic 03 · mercadolibre-sync, Sprint 5 · US-13). Maps a raw backend
 * sync-event row → an es-MX label + a tone the status surface can render, and
 * formats the timestamp. No next/cache, no network — importable by the Playwright
 * `api` runner (unit tests) and the server component alike.
 *
 * The backend already redacts `message` (never a token, never a stack trace); this
 * module only decides how to LABEL and TONE an event, never re-derives correctness.
 */

export type MlSyncEvent = {
  id: string
  kind: string
  outcome: string
  code: string | null
  message: string | null
  product_id: string | null
  ml_item_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

export type MlEventTone = 'ok' | 'fail'

/** es-MX label for an event kind (unknown kinds fall back to a generic label). */
export function mlEventLabel(kind: string): string {
  switch (kind) {
    case 'token_refresh':
      return 'Reautorización requerida'
    case 'publish':
      return 'Publicación en Mercado Libre'
    case 'close':
      return 'Cierre de publicación'
    case 'stock_push':
      return 'Sincronización de existencia'
    case 'sale_applied':
      return 'Venta de Mercado Libre aplicada'
    case 'reconcile':
      return 'Reconciliación'
    case 'import':
      return 'Importación de catálogo'
    default:
      return 'Evento de sincronización'
  }
}

/** The tone the badge uses: `fail` for a failed outcome, else `ok`. */
export function mlEventTone(outcome: string): MlEventTone {
  return outcome === 'fail' ? 'fail' : 'ok'
}

/** Format an ISO timestamp for the log (es-MX), '—' when absent/invalid. */
export function fmtMlEventDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  try {
    return new Date(t).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

/** A view-model row: everything the status surface needs to render one line. */
export type MlEventView = {
  id: string
  label: string
  tone: MlEventTone
  message: string | null
  when: string
}

/** Render cap for a message — defense-in-depth vs a long/unbounded row breaking layout
 *  (the backend already caps + redacts on write; this protects the render regardless). */
export const MAX_RENDERED_MESSAGE_LEN = 300

function clampMessage(msg: string | null | undefined): string | null {
  if (msg == null) return null
  const s = String(msg)
  return s.length > MAX_RENDERED_MESSAGE_LEN ? `${s.slice(0, MAX_RENDERED_MESSAGE_LEN - 1)}…` : s
}

/** Map raw events → view rows (pure). Drops nothing; the backend already bounds count. */
export function toMlEventViews(events: MlSyncEvent[] | null | undefined): MlEventView[] {
  return (events ?? []).map((e) => ({
    id: e.id,
    label: mlEventLabel(e.kind),
    tone: mlEventTone(e.outcome),
    message: clampMessage(e.message),
    when: fmtMlEventDate(e.created_at),
  }))
}
