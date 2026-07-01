/**
 * lib/ml-events.ts
 *
 * Server-side bridge to the Mercado Libre module's per-seller sync activity log
 * (epic 03 · mercadolibre-sync, Sprint 5 · US-13). The Medusa `mercadolibre`
 * module owns the append-only log (co-located with the sync core); this reads it
 * (and appends an FE-origin `import` event) via the internal backend routes.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Reads fail CLOSED to an empty list so
 * a backend hiccup never breaks the status page; the append is best-effort (a failed
 * log write must never fail the seller's action).
 */
import 'server-only'
import type { MlSyncEvent } from '@/lib/ml-events-view'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Recent sync-activity events for a seller (newest first). Fails closed to []. */
export async function getMlSyncEvents(sellerSlug: string, limit = 50): Promise<MlSyncEvent[]> {
  if (!sellerSlug || !INTERNAL_SECRET) return []
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml/events?seller_slug=${encodeURIComponent(sellerSlug)}&limit=${limit}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return []
    const d = (await res.json()) as { events?: MlSyncEvent[] }
    return Array.isArray(d.events) ? d.events : []
  } catch {
    return []
  }
}

/**
 * Append an FE-origin sync event (used by the import route to record `import`,
 * which is the only kind that originates on the frontend). Best-effort: never
 * throws, returns false on any failure so the caller's action still succeeds.
 */
export async function logMlSyncEvent(input: {
  sellerSlug: string
  kind: string
  outcome?: 'ok' | 'fail'
  productId?: string | null
  mlItemId?: string | null
  code?: string | null
  message?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<boolean> {
  if (!input.sellerSlug || !INTERNAL_SECRET) return false
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        seller_slug: input.sellerSlug,
        kind: input.kind,
        outcome: input.outcome ?? 'ok',
        product_id: input.productId ?? null,
        ml_item_id: input.mlItemId ?? null,
        code: input.code ?? null,
        message: input.message ?? null,
        metadata: input.metadata ?? null,
      }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
