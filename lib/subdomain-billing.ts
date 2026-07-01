/**
 * lib/subdomain-billing.ts
 *
 * The subdomain SKU's recurring BILLING INTERVAL (epic 07 · subdomain-pricing,
 * Sprint 3). This is a NEW dimension, orthogonal to the S2 `DomainCadence`
 * (`recurring | one_time`): the recurring cadence can bill either yearly ($199/yr,
 * the discounted default) or monthly ($25/mo, the no-annual-commitment entry). Both
 * intervals are prices on the SAME platform plan, so a seller can switch between
 * them on the same Stripe subscription (proration) with no entitlement gap.
 *
 * Monthly is RECURRING-only — the `one_time` cadence (pay a year up front, no
 * mandate) has no monthly analogue and always means a year.
 *
 * Pure + next-free + no `server-only` → the interval coercion, the interval→price
 * selection, and the pure `decideCadenceSwitch` are directly unit-testable by the
 * Playwright `api` runner (e2e/subdomain-monthly.spec.ts).
 */

export type SubdomainInterval = 'month' | 'year'

export const SUBDOMAIN_INTERVALS: readonly SubdomainInterval[] = ['month', 'year'] as const

/** Yearly is the default — matches the S2 recurring path (back-compat). */
export const DEFAULT_SUBDOMAIN_INTERVAL: SubdomainInterval = 'year'

/** Narrow arbitrary input to a known interval; unknown/blank → null. */
export function asSubdomainInterval(raw: unknown): SubdomainInterval | null {
  return raw === 'month' || raw === 'year' ? raw : null
}

/** Coerce input to an interval, defaulting unknown/blank to `year` (back-compat). */
export function coerceSubdomainInterval(raw: unknown): SubdomainInterval {
  return asSubdomainInterval(raw) ?? DEFAULT_SUBDOMAIN_INTERVAL
}

/** es-MX label for an interval (agent copy + pricing surfaces). */
export function subdomainIntervalLabel(interval: SubdomainInterval): string {
  return interval === 'month' ? 'Mensual ($25 MXN/mes)' : 'Anual ($199 MXN/año)'
}

/**
 * Pick the plan's Stripe price id for a recurring interval. Yearly is the plan's
 * `stripe_price_id` column; monthly is held on the plan metadata. Returns null when
 * the requested interval's price hasn't been seeded yet (the caller degrades to
 * "el plan aún no está disponible" — the graceful pre-seed path).
 */
export function subdomainPriceIdForInterval(
  interval: SubdomainInterval,
  prices: { yearly: string | null; monthly: string | null },
): string | null {
  return interval === 'month' ? prices.monthly : prices.yearly
}

export type CadenceSwitchDecision =
  | { action: 'switch'; target: SubdomainInterval }
  | { action: 'noop'; target: SubdomainInterval }
  | { action: 'refuse'; reason: 'no_subscription' | 'no_price' }

/**
 * The pure decision for a monthly↔yearly switch, so the route stays a thin wrapper
 * around Stripe. A switch is only possible on an ACTIVE RECURRING subscription (a
 * one-time grant or an unpaid shop has no Stripe subscription to prorate). Switching
 * to the cadence you're already on is a no-op (never re-charges). The target price
 * must exist (both cadences seeded).
 */
export function decideCadenceSwitch(input: {
  current: SubdomainInterval | null
  target: SubdomainInterval
  hasActiveRecurring: boolean
  targetPriceId: string | null
}): CadenceSwitchDecision {
  const { current, target, hasActiveRecurring, targetPriceId } = input
  if (!hasActiveRecurring) return { action: 'refuse', reason: 'no_subscription' }
  if (!targetPriceId) return { action: 'refuse', reason: 'no_price' }
  if (current === target) return { action: 'noop', target }
  return { action: 'switch', target }
}

/** es-MX refusal copy for a switch that can't proceed. */
export function cadenceSwitchRefusalMessage(reason: 'no_subscription' | 'no_price'): string {
  return reason === 'no_subscription'
    ? 'No tienes una suscripción activa al subdominio para cambiar de plan.'
    : 'Ese plan aún no está disponible. Intenta más tarde.'
}
