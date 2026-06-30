/**
 * lib/domain-cadence.ts
 *
 * The custom-domain SKU's payment cadence (epic 08 · promoter-program, S2). Two
 * cadences sit side by side on the SAME SKU:
 *   - `recurring`  → Stripe `mode:'subscription'` (today's annual subscription).
 *   - `one_time`   → Stripe `mode:'payment'` (pay a year up front, NO recurring
 *                    mandate; entitlement is a dated 12-month grant that lapses
 *                    on read). This is the enabler for the in-person cash close.
 *
 * Pure + next-free so the cadence validation + the cadence→Stripe-mode mapping are
 * directly unit-testable (e2e/promoter-cadence.spec.ts) without Stripe or `server-only`.
 */

export type DomainCadence = 'recurring' | 'one_time'

export const DOMAIN_CADENCES: readonly DomainCadence[] = ['recurring', 'one_time'] as const

export const DEFAULT_DOMAIN_CADENCE: DomainCadence = 'recurring'

/** Narrow arbitrary input to a known cadence; unknown/blank → null. */
export function asDomainCadence(raw: unknown): DomainCadence | null {
  return raw === 'recurring' || raw === 'one_time' ? raw : null
}

/** Coerce input to a cadence, defaulting unknown/blank to `recurring` (back-compat). */
export function coerceDomainCadence(raw: unknown): DomainCadence {
  return asDomainCadence(raw) ?? DEFAULT_DOMAIN_CADENCE
}

/**
 * The Stripe Checkout `mode` for a cadence. `one_time → 'payment'` is the
 * load-bearing guarantee that NO Stripe Subscription / upcoming invoice is ever
 * created for the one-time cadence (so nothing auto-charges at year end).
 */
export function stripeModeForCadence(cadence: DomainCadence): 'subscription' | 'payment' {
  return cadence === 'one_time' ? 'payment' : 'subscription'
}

/** es-MX label for the cadence choice (the Canal upsell + agent copy). */
export function domainCadenceLabel(cadence: DomainCadence): string {
  return cadence === 'one_time'
    ? 'Pagar un año (pago único)'
    : 'Suscripción anual (se renueva)'
}
