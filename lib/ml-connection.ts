/**
 * lib/ml-connection.ts
 *
 * Server-side bridge to the Mercado Libre Medusa module (epic 03 ·
 * mercadolibre-sync, Sprint 1). The Medusa `mercadolibre` module is the SOURCE
 * OF TRUTH for the seller's ML connection (AGENTS rule #1) and stores the tokens
 * encrypted at rest; this module reads/mutates it via the internal backend
 * routes. Tokens never transit the frontend — only the sanitised connection
 * (nickname + health, no token fields) crosses this boundary.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Every read fails CLOSED to
 * "disconnected" so a backend hiccup never wrongly shows "connected".
 */
import 'server-only'
import type { MlHealth, MlHealthState } from './ml-health'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export type SanitizedMlConnection = {
  id: string
  seller_id: string
  ml_user_id: string
  ml_nickname: string | null
  country_code: string
  status: string
  expires_at: string | null
  last_refreshed_at: string | null
}

export type MlConnectionView = {
  connection: SanitizedMlConnection | null
  health: MlHealth
}

const DISCONNECTED: MlConnectionView = {
  connection: null,
  health: { state: 'disconnected' as MlHealthState, label_es: 'No conectado' },
}

/** Read the seller's ML connection (sanitised) + derived health. Fails closed. */
export async function getMlConnection(sellerSlug: string): Promise<MlConnectionView> {
  if (!sellerSlug || !INTERNAL_SECRET) return DISCONNECTED
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml/connection?seller_slug=${encodeURIComponent(sellerSlug)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return DISCONNECTED
    const d = (await res.json()) as Partial<MlConnectionView>
    return {
      connection: d.connection ?? null,
      health: d.health ?? DISCONNECTED.health,
    }
  } catch {
    return DISCONNECTED
  }
}

/** Complete the OAuth exchange for a seller (called by the callback route). */
export async function connectMlForSeller(
  sellerSlug: string,
  code: string,
): Promise<{ ok: boolean; nickname?: string | null }> {
  if (!sellerSlug || !code || !INTERNAL_SECRET) return { ok: false }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, code }),
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false }
    const d = (await res.json()) as { connection?: SanitizedMlConnection | null }
    return { ok: true, nickname: d.connection?.ml_nickname ?? null }
  } catch {
    return { ok: false }
  }
}

/** Disconnect the seller's ML account. */
export async function disconnectMlForSeller(sellerSlug: string): Promise<{ ok: boolean }> {
  if (!sellerSlug || !INTERNAL_SECRET) return { ok: false }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/connection`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug }),
      cache: 'no-store',
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}
