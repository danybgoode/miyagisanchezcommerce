/**
 * lib/flags-admin.ts
 *
 * The PURE half of the admin flag-control surface (epic 09 · feature-flags-inhouse,
 * Sprint 2). Kept free of `next/*`, `server-only`, and the Supabase client — like its
 * sibling `lib/flags-cache.ts` — so the write route's key/body validation is unit-
 * testable in the Playwright `api` runner with zero network (`e2e/flags-admin.spec.ts`).
 *
 * It carries the DISPLAY metadata the serving reader deliberately omits: `lib/flags.ts`
 * reads only `key, enabled` (the fail-open decision needs nothing more), but the admin
 * page must show every flag's polarity + fail-open default and must render a flag even
 * when its `platform_flags` row is ABSENT (an absent row ⇒ `isEnabled()` falls open to
 * DEFAULT_FLAGS, so the admin view unions the known keys with the DB rows).
 *
 * Drift guard: the keys, defaults and classifications are all derived from
 * `lib/flag-catalog.ts`, so this display seam cannot carry a second drifting list.
 */
import {
  FLAG_CATALOG,
  FLAG_KEYS,
  type FlagKey,
  type FlagPolarity,
} from './flag-catalog'

export { FLAG_KEYS }
export type { FlagKey, FlagPolarity }

/**
 * Both fail-open polarities (doc-only, mirrors the `platform_flags.polarity` column):
 *  - `killswitch` → default ON  (the feature keeps working if the store is down; the
 *    deliberate act is disabling — e.g. `checkout.stripe_enabled`, `pdp_redesign`).
 *  - `enablement` → default OFF (the gate stays off if the store is down; the
 *    deliberate act is enabling — e.g. `subdomain.paywall_enabled`).
 */
export interface FlagMeta {
  /** Fail-open polarity (informational — shown in the admin table). */
  polarity: FlagPolarity
  /** The value `isEnabled()` returns when the row is absent (= DEFAULT_FLAGS). */
  default: boolean
}

/**
 * Admin projection of the typed catalog. The catalog is the only hand-maintained
 * inventory; this map is derived so no key/default can be omitted or duplicated.
 */
export const FLAG_META = Object.freeze(
  Object.fromEntries(
    FLAG_KEYS.map((key) => [
      key,
      {
        polarity: FLAG_CATALOG[key].polarity,
        default: FLAG_CATALOG[key].default,
      },
    ]),
  ) as Record<FlagKey, FlagMeta>,
)

/** Narrow an untrusted value to a known `FlagKey`. */
export function isKnownFlagKey(key: unknown): key is FlagKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FLAG_META, key)
}

/** Parsed, validated flag-write body — a discriminated result (never throws). */
export type FlagWriteParse =
  | { ok: true; key: FlagKey; enabled: boolean; expectedSnapshotVersion: number; reason: string }
  | { ok: false; error: string }

/**
 * Validate the `POST /api/admin/flags` body. Rejects (Spanish `error`) an unknown flag
 * key or a non-boolean `enabled` — so a malformed body or a stray agent call can never
 * upsert a garbage row (which `resolveFlag`'s `typeof === 'boolean'` guard would then
 * fail OPEN over, masking the write). This is a MUTATION on a money-adjacent surface, so
 * it rejects rather than coerces (per LEARNINGS: coerce a purchase, reject a mutation).
 */
export function parseFlagWriteBody(body: unknown): FlagWriteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { key, enabled, expectedSnapshotVersion, reason } = body as {
    key?: unknown
    enabled?: unknown
    expectedSnapshotVersion?: unknown
    reason?: unknown
  }
  if (!isKnownFlagKey(key)) {
    return { ok: false, error: 'Flag desconocida.' }
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: 'El valor "enabled" debe ser booleano.' }
  }
  if (
    typeof expectedSnapshotVersion !== 'number' ||
    !Number.isSafeInteger(expectedSnapshotVersion) ||
    expectedSnapshotVersion < 0
  ) {
    return { ok: false, error: 'La versión de la snapshot es inválida.' }
  }
  const safeReason = typeof reason === 'string' ? reason.trim() : ''
  if (safeReason.length < 1 || safeReason.length > 500) {
    return { ok: false, error: 'Se requiere un motivo de 1 a 500 caracteres.' }
  }
  return { ok: true, key, enabled, expectedSnapshotVersion, reason: safeReason }
}
