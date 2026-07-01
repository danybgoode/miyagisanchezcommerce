/**
 * lib/ml-sync-billing.ts
 *
 * The ML-sync SKU's recurring BILLING INTERVAL (epic 03 · mercadolibre-sync,
 * Sprint 6). Orthogonal to the `DomainCadence` (`recurring | one_time`): the
 * recurring cadence bills either yearly ($299/yr, the discounted default) or
 * monthly ($30/mo). Both intervals are prices on the SAME platform plan.
 *
 * Monthly is RECURRING-only — the `one_time` cadence (pay a year up front, no
 * mandate) always means a year. Mirrors `lib/subdomain-billing.ts`.
 *
 * Pure + next-free → the interval coercion + interval→price selection are directly
 * unit-testable by the Playwright `api` runner.
 */

export type MlSyncInterval = 'month' | 'year'

export const ML_SYNC_INTERVALS: readonly MlSyncInterval[] = ['month', 'year'] as const

/** Yearly is the default (back-compat with a blank interval → the discounted plan). */
export const DEFAULT_ML_SYNC_INTERVAL: MlSyncInterval = 'year'

/** Narrow arbitrary input to a known interval; unknown/blank → null. */
export function asMlSyncInterval(raw: unknown): MlSyncInterval | null {
  return raw === 'month' || raw === 'year' ? raw : null
}

/** Coerce input to an interval, defaulting unknown/blank to `year` (back-compat). */
export function coerceMlSyncInterval(raw: unknown): MlSyncInterval {
  return asMlSyncInterval(raw) ?? DEFAULT_ML_SYNC_INTERVAL
}

/** es-MX label for an interval (upsell copy + agent surfaces). */
export function mlSyncIntervalLabel(interval: MlSyncInterval): string {
  return interval === 'month' ? 'Mensual ($30 MXN/mes)' : 'Anual ($299 MXN/año)'
}

/**
 * Pick the plan's Stripe price id for a recurring interval. Yearly is the plan's
 * `stripe_price_id` column; monthly is held on the plan metadata. Returns null when
 * the requested interval's price hasn't been seeded yet (the caller degrades to
 * "el plan aún no está disponible").
 */
export function mlSyncPriceIdForInterval(
  interval: MlSyncInterval,
  prices: { yearly: string | null; monthly: string | null },
): string | null {
  return interval === 'month' ? prices.monthly : prices.yearly
}
