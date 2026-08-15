/**
 * lib/seller-status.ts
 *
 * The storefront's copy of the seller lifecycle vocabulary
 * (tenant-lifecycle-admin · D1).
 *
 * ── WHY A COPY EXISTS AT ALL ──────────────────────────────────────────────────
 * The authoritative definition lives in the backend
 * (`apps/backend/src/lib/seller-status.ts`) because Medusa owns the seller. These
 * are separate repositories with separate deploys, so there is no import to share —
 * and a paraphrased contract drifts permissive, which this codebase has been bitten
 * by five times.
 *
 * Two things keep the drift honest rather than silent:
 *
 *  1. This file carries ONLY the vocabulary and the display mapping — the three
 *     status values and their es-MX labels. It deliberately does NOT restate the
 *     enforcement rules (what admits, what a transition may do, what an absent value
 *     means on a money path). Those live in the backend and are enforced there, so
 *     there is nothing here for a reader to mistake for the boundary.
 *  2. `e2e/seller-status-vocabulary.spec.ts` reads the backend's own source and
 *     asserts the value lists match. If the backend adds a state, that spec goes red
 *     here rather than the admin silently rendering an unknown status as blank.
 *
 * Pure. No `server-only`, no I/O — the Playwright `api` runner imports it directly.
 */

/** Must equal `SELLER_STATUSES` in `apps/backend/src/lib/seller-status.ts`. */
export const SELLER_STATUSES = ['active', 'paused', 'deleted'] as const
export type SellerStatus = (typeof SELLER_STATUSES)[number]

export function isSellerStatus(value: unknown): value is SellerStatus {
  return typeof value === 'string' && (SELLER_STATUSES as readonly string[]).includes(value)
}

/**
 * Parse a status off an API payload.
 *
 * Returns `null` for anything unrecognised INCLUDING absent — the admin is a
 * read/display surface, and showing "activa" for a shop whose status we could not
 * read would be a confident falsehood on the one screen an operator uses to decide
 * whether to intervene.
 */
export function parseSellerStatus(value: unknown): SellerStatus | null {
  return isSellerStatus(value) ? value : null
}

/** es-MX labels for the directory. `null` is the honestly-unavailable state. */
export function sellerStatusLabel(status: SellerStatus | null): string {
  switch (status) {
    case 'active':
      return 'Activa'
    case 'paused':
      return 'En pausa'
    case 'deleted':
      return 'Eliminada'
    default:
      return 'No disponible'
  }
}

/** Tone for the status chip. `null` is neutral, never green. */
export function sellerStatusTone(status: SellerStatus | null): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'active':
      return 'ok'
    case 'paused':
      return 'warn'
    case 'deleted':
      return 'danger'
    default:
      return 'muted'
  }
}
