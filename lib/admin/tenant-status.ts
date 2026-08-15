/**
 * lib/admin/tenant-status.ts
 *
 * The admin's client for the Medusa seller lifecycle
 * (tenant-lifecycle-admin · D8, S3.3).
 *
 * ── EVERY WRITE GOES THROUGH MEDUSA ───────────────────────────────────────────
 * This module never touches `marketplace_shops` to change a status. Medusa owns the
 * seller (AGENTS rule 1), the internal route owns the transition, and the mirror is a
 * display projection that gets refreshed FROM Medusa afterwards — never written first
 * and reconciled later. That ordering is `admin-consolidation`'s D4 and this epic's
 * D8, and it is what keeps the directory a strict read-model over canonical ids.
 *
 * ── THREE STATES ON EVERY READ ────────────────────────────────────────────────
 * A read returns the status, or `null` for "there is no such seller", or
 * `'unavailable'` when the backend could not be reached. The admin renders the third
 * as *no disponible* rather than as *activa* — this is the screen an operator uses to
 * decide whether to intervene, so a confident falsehood here is the expensive kind.
 */
import 'server-only'
import { parseSellerStatus, type SellerStatus } from '@/lib/seller-status'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Bounded: the directory fans this across every shop. */
const TIMEOUT_MS = 5_000

export type TenantStatusRead =
  | { readonly state: 'resolved'; readonly status: SellerStatus; readonly pausedLinkCount: number }
  | { readonly state: 'absent' }
  | { readonly state: 'unavailable'; readonly reason: string }

/** Flatten a read into the value the directory row carries (three states). */
export function statusForRow(read: TenantStatusRead): SellerStatus | 'absent' | 'unavailable' {
  return read.state === 'resolved' ? read.status : read.state
}

export async function readSellerStatus(
  medusaSellerId: string | null | undefined,
): Promise<TenantStatusRead> {
  if (!medusaSellerId) return { state: 'absent' }
  if (!INTERNAL_SECRET) {
    // An unconfigured secret is an OPERATOR fault, and saying "unavailable" is the
    // honest answer. Reporting every shop as active because we hold no credential
    // would be exactly the confident-empty-result failure AGENTS rule 5 forbids.
    return { state: 'unavailable', reason: 'MEDUSA_INTERNAL_SECRET is not configured' }
  }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/sellers/${encodeURIComponent(medusaSellerId)}/status`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 404) return { state: 'absent' }
    if (!res.ok) return { state: 'unavailable', reason: `HTTP ${res.status}` }
    const body = (await res.json()) as {
      status?: unknown
      readable?: unknown
      paused_link_count?: unknown
    }
    const status = parseSellerStatus(body.status)
    // The route reports `readable: false` when the stored value could not be parsed.
    // That is an unavailable status, not an absent seller.
    if (!status) return { state: 'unavailable', reason: 'seller status is unreadable' }
    return {
      state: 'resolved',
      status,
      pausedLinkCount: Number.isFinite(body.paused_link_count) ? Number(body.paused_link_count) : 0,
    }
  } catch (err) {
    return { state: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }
}

export type StatusChangeResult =
  | {
      readonly ok: true
      readonly from: SellerStatus
      readonly to: SellerStatus
      readonly unlinked: number
      readonly restored: number
      readonly missingProducts: string[]
      /** False when the backend could not replay everything it recorded. */
      readonly complete: boolean
    }
  | { readonly ok: false; readonly status: number; readonly message: string }

/**
 * Change a seller's lifecycle status through Medusa.
 *
 * The backend makes every decision — what to unlink, what to relink, whether the
 * transition is even legal. This function transports a request and reports the
 * answer verbatim, INCLUDING an incomplete outcome: a partial restore comes back
 * `complete: false` and the admin says so, because "the shop is back" when some of
 * its products are not is the report-must-match-what-happened failure.
 */
export async function changeSellerStatus(input: {
  medusaSellerId: string
  status: SellerStatus
  reason: string
}): Promise<StatusChangeResult> {
  if (!INTERNAL_SECRET) {
    return { ok: false, status: 503, message: 'No se puede contactar al backend de comercio.' }
  }
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/sellers/${encodeURIComponent(input.medusaSellerId)}/status`,
      {
        method: 'POST',
        headers: { 'x-internal-secret': INTERNAL_SECRET, 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000), // unlinking a large catalog is not instant
        body: JSON.stringify({ status: input.status, reason: input.reason }),
      },
    )
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: typeof body?.message === 'string' ? body.message : `Error ${res.status}`,
      }
    }

    // VALIDATE THE SUCCESS PAYLOAD. A 2xx is not a contract: malformed JSON, a
    // missing field, or a status this deploy has never heard of (the backend ships
    // separately and may add one) would otherwise be reported as a completed change
    // — and `from`/`to` would silently default to whatever was REQUESTED, so the
    // screen would show the operator their own intent as though it were the result.
    // `complete` is the sharpest case: `body?.complete !== false` treats a MISSING
    // field as complete, so a truncated response would render a partial restore as
    // "listo".
    const from = parseSellerStatus(body?.from)
    const to = parseSellerStatus(body?.to)
    if (!from || !to || typeof body?.complete !== 'boolean') {
      return {
        ok: false,
        status: 502,
        message: 'El backend respondió algo que no entendemos. No confirmes el cambio hasta revisarlo.',
      }
    }

    return {
      ok: true,
      from,
      to,
      unlinked: Number.isFinite(body.unlinked) ? Number(body.unlinked) : 0,
      restored: Number.isFinite(body.restored) ? Number(body.restored) : 0,
      missingProducts: Array.isArray(body.missing_products)
        ? (body.missing_products as unknown[]).filter((id): id is string => typeof id === 'string')
        : [],
      complete: body.complete,
    }
  } catch (err) {
    return {
      ok: false,
      status: 503,
      message: err instanceof Error ? err.message : 'No se pudo cambiar el estado.',
    }
  }
}
