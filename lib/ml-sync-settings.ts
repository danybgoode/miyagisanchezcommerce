/**
 * lib/ml-sync-settings.ts
 *
 * Server-side bridge to the Mercado Libre module's per-seller stock-sync enable
 * (epic 03 · mercadolibre-sync — the S4 backend enable, now given a seller-facing
 * surface in S5 · US-14). The Medusa module owns the flag on the connection
 * metadata; this reads/writes it via the internal backend route.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Reads fail CLOSED to disabled.
 */
import 'server-only'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Read the seller's per-seller stock-sync enable. Fails closed to `false`. */
export async function getSellerSyncEnabled(sellerSlug: string): Promise<boolean> {
  if (!sellerSlug || !INTERNAL_SECRET) return false
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml/sync-settings?seller_slug=${encodeURIComponent(sellerSlug)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return false
    const d = (await res.json()) as { sync_enabled?: boolean }
    return d.sync_enabled === true
  } catch {
    return false
  }
}

export type SetSyncResult =
  | { ok: true; sync_enabled: boolean }
  | { ok: false; reason: 'not_connected' | 'failed' }

/** Set the seller's per-seller stock-sync enable. */
export async function setSellerSyncEnabled(sellerSlug: string, enabled: boolean): Promise<SetSyncResult> {
  if (!sellerSlug || !INTERNAL_SECRET) return { ok: false, reason: 'failed' }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/sync-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, enabled }),
      cache: 'no-store',
    })
    if (res.status === 409) return { ok: false, reason: 'not_connected' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const d = (await res.json()) as { sync_enabled?: boolean }
    return { ok: true, sync_enabled: d.sync_enabled === true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
